import type { Chart, DataLoader, KLineData, Period } from 'klinecharts'
import { BAR_LIMIT, POLL_INTERVAL_MS, TIMESPAN_MILLIS, cnPeriodKey } from './constants'
import { timeShareState } from './timeshare'
import { symbolCode, type SymbolRef, type TimeShareSnapshot } from './types'
import { guessCnMarket, isCnIndex, isCnStarMarket } from './utils'

export interface DataLoaderDeps {
  chart: Chart
  /** 分时形态切换（数据就绪后同帧调用） */
  applyTimeShareTransforms: () => void
  /** 全天一屏校准 */
  calibrateTimeShareFit: (dataCount: number) => void
  /** 轮询首次更新后的复校登记 */
  fitTimeShareBars: (dataCount: number) => void
  /** SSR 注入的首屏日 K（仅初始标的 init 请求消费一次） */
  initial?: { code: string; bars: KLineData[] } | null
}

const fetchTimeShareSnapshot = async (code: string): Promise<TimeShareSnapshot> => {
  const response = await fetch(`/api/timeshare?symbol=${code}`)
  if (!response.ok) {
    throw new Error(`timeshare api responded ${response.status}`)
  }
  return (await response.json()) as TimeShareSnapshot
}

const fetchKlineBars = async (code: string, period: Period, from: number, to: number): Promise<KLineData[]> => {
  const response = await fetch(`/api/kline?symbol=${code}&period=${cnPeriodKey(period)}&from=${from}&to=${to}`)
  if (!response.ok) {
    throw new Error(`kline api responded ${response.status}`)
  }
  const data = (await response.json()) as { bars: KLineData[] }
  return data.bars ?? []
}

const syncTimeShareSymbolFlags = (symbol: SymbolRef): void => {
  // 科创板分时量为「股」（每手 200 股），其余板块为「手」（每手 100 股）
  timeShareState.lotSize = isCnStarMarket(symbol) ? 200 : 100
  // 指数标记：均价线与个股口径不同
  timeShareState.isIndex = isCnIndex(symbol)
}

/** klinecharts SymbolInfo（market 走索引签名）转严格 SymbolRef */
const refOf = (symbol: { ticker: string; market?: unknown }): SymbolRef => ({
  ticker: symbol.ticker,
  market: typeof symbol.market === 'string' ? symbol.market : guessCnMarket(symbol.ticker)
})

/**
 * BFF 版 DataLoader：K 线 / 分时均经由服务端聚合接口（缓存 + 限流在服务端）。
 * 语义与原浏览器直连版一致：init 全量、forward 历史回看、backward 增量、subscribeBar 3 秒轮询。
 */
export const createDataLoader = (deps: DataLoaderDeps): DataLoader => {
  const { chart } = deps
  let initial = deps.initial ?? null
  let cnPollTimer: ReturnType<typeof setInterval> | undefined
  // 轮询首次更新后的复校标记：init 布局已校准显示，若更新重建刻度导致
  // 左轴宽度变化再收敛一次（宽度未变时校准内 setBarSpace 同值直返，无重绘）
  let pendingTimeShareFit = 0

  const stopCnPolling = () => {
    if (cnPollTimer != null) {
      clearInterval(cnPollTimer)
      cnPollTimer = undefined
    }
  }

  return {
    getBars: async ({ type, timestamp, symbol, period, callback }) => {
      const code = symbolCode(refOf(symbol))
      // 分时：官方分时接口一次返回当日分钟数据与昨收基准
      if (timeShareState.active) {
        // 当日数据 init 时已全量，历史与增量均无更多（更新由轮询承担）。
        // backward 若返回数据且 more=true，会与 setOffsetRightDistance(0)
        // 联动反复触发 _adjustVisibleRange -> backward 加载，造成死循环
        if (type !== 'init') {
          callback([], { forward: false, backward: false })
          return
        }
        syncTimeShareSymbolFlags(refOf(symbol))
        try {
          const snapshot = await fetchTimeShareSnapshot(code)
          if (!timeShareState.active) {
            // 加载期间已切走周期，放弃注入避免清掉新周期的图
            callback([], false)
            return
          }
          timeShareState.dayKey = snapshot.date
          timeShareState.prevClose = snapshot.prevClose
          // 数据就绪：形态切换、数据注入、全天一屏校准在同一帧完成，
          // 旧图直接替换为最终分时布局（callback 前 prevClose 已就绪，
          // 百分比左轴首次布局即为最终宽度）
          deps.applyTimeShareTransforms()
          callback(snapshot.bars, false)
          deps.calibrateTimeShareFit(snapshot.bars.length)
          // 轮询首次更新后的复校仅作宽度变化兜底，宽度未变时为空操作
          deps.fitTimeShareBars(snapshot.bars.length)
        } catch {
          if (timeShareState.active) {
            // 失败也切到分时形态，与普通周期加载失败后的空网格表现一致，
            // 轮询订阅随后建立可继续补数
            deps.applyTimeShareTransforms()
          }
          callback([], false)
        }
        return
      }
      // init + SSR 首屏注入：免首轮网络往返
      if (type === 'init' && initial != null && initial.code === code && period.type === 'day' && period.span === 1) {
        const bars = initial.bars
        initial = null
        callback(bars, true)
        return
      }
      const spanMillis = period.span * TIMESPAN_MILLIS[period.type]
      let to = Date.now()
      let from = to - BAR_LIMIT * spanMillis
      // klinecharts v10 语义：forward = timestamp 取最旧 bar，加载更早历史；backward = timestamp 取最新 bar，加载更新数据
      if (type === 'forward' && timestamp != null) {
        to = timestamp - 1
        from = to - BAR_LIMIT * spanMillis
      } else if (type === 'backward' && timestamp != null) {
        from = timestamp + 1
      }
      try {
        const dataList = await fetchKlineBars(code, period, from, to)
        if (type === 'forward') {
          callback(dataList, { forward: dataList.length > 0 })
        } else if (type === 'backward') {
          callback(dataList, { backward: dataList.length > 0 })
        } else {
          callback(dataList, true)
        }
      } catch {
        callback([], false)
      }
    },
    subscribeBar: ({ symbol, period, callback }) => {
      // A股无免费浏览器 WebSocket 行情，经 BFF 3 秒轮询刷新最新一根 bar
      stopCnPolling()
      // 快照订阅时的分时状态：切换分时/周期后，旧订阅在途的轮询结果不再
      // 注入，避免把分时 bar 追加到过渡期的旧图或新周期图表上
      const pollTimeShare = timeShareState.active
      const code = symbolCode(refOf(symbol))
      if (pollTimeShare) {
        syncTimeShareSymbolFlags(refOf(symbol))
      }
      let lastPolled: KLineData | null = null
      const emitIfChanged = (last: KLineData) => {
        // 最新一根未变化时跳过，避免每 3 秒无意义重绘
        if (
          lastPolled != null &&
          lastPolled.timestamp === last.timestamp &&
          lastPolled.close === last.close &&
          lastPolled.volume === last.volume
        ) {
          return
        }
        const isFirstEmit = lastPolled == null
        lastPolled = last
        callback(last)
        if (isFirstEmit && pollTimeShare && timeShareState.active && pendingTimeShareFit > 0) {
          const count = pendingTimeShareFit
          pendingTimeShareFit = 0
          // 首次更新后复校一次：兜底刻度重建导致左轴宽度变化的场景，
          // 宽度未变时为空操作，不会引起可见跳动
          window.setTimeout(() => {
            deps.calibrateTimeShareFit(count)
          }, 0)
        }
      }
      const poll = async () => {
        try {
          if (pollTimeShare !== timeShareState.active) {
            // 订阅过期：分时/周期状态已切换，停止注入本订阅的数据
            return
          }
          if (pollTimeShare) {
            const snapshot = await fetchTimeShareSnapshot(code)
            if (timeShareState.dayKey != null && snapshot.date !== timeShareState.dayKey) {
              // 跨交易日：整体重载切换到新的一天（含昨收刷新）
              chart.setPeriod({ span: 1, type: 'minute' })
              return
            }
            const last = snapshot.bars[snapshot.bars.length - 1]
            if (last != null) {
              emitIfChanged(last)
            }
            return
          }
          const spanMillis = period.span * TIMESPAN_MILLIS[period.type]
          const dataList = await fetchKlineBars(code, period, Date.now() - spanMillis * 20, Date.now())
          const last = dataList[dataList.length - 1]
          if (last != null) {
            emitIfChanged(last)
          }
        } catch {
          // 忽略单次轮询失败
        }
      }
      void poll()
      cnPollTimer = setInterval(() => {
        void poll()
      }, POLL_INTERVAL_MS)
    },
    unsubscribeBar: () => {
      stopCnPolling()
    }
  }
}
