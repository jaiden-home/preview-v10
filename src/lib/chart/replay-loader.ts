// ==================== 回放数据源（klinecharts DataLoader 实现，仅客户端使用） ====================
// 极速模拟页图表的数据管线：可见日 K（起始日前历史 + 已完成模拟日）由引擎侧全量供给，
// 周/月周期由日 K 本地聚合；引擎每完成一个交易日经 pushDay 向当前订阅推送最新 bar
// （日周期 = 新时间戳追加，周/月 = 同桶更新或新桶追加，均走 klinecharts update 通道）。
// 类型引用 klinecharts（type-only，不入服务端模块图）。

import type { DataLoader, KLineData, Period } from 'klinecharts'
import { symbolCode } from './types'
import { guessCnMarket } from './utils'

/** 周/月桶起始时间戳（周一 / 月初，本地时区） */
const bucketStartOf = (timestamp: number, type: Period['type']): number => {
  const d = new Date(timestamp)
  if (type === 'month') {
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }
  const weekday = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - weekday).getTime()
}

/** 日 K → 周/月 K 聚合（open=首日、close=末日、high/low=极值、量额求和）；其余周期原样/为空 */
export const aggregateDaily = (bars: KLineData[], period: Period): KLineData[] => {
  if (period.type === 'day') {
    return bars
  }
  if (period.type !== 'week' && period.type !== 'month') {
    // 分钟等周期无回放数据（极速模拟页周期组仅日/周/月）
    return []
  }
  const out: KLineData[] = []
  for (const bar of bars) {
    const key = bucketStartOf(bar.timestamp, period.type)
    const last = out[out.length - 1]
    if (last != null && last.timestamp === key) {
      last.close = bar.close
      last.high = Math.max(last.high, bar.high)
      last.low = Math.min(last.low, bar.low)
      last.volume = (last.volume ?? 0) + (bar.volume ?? 0)
      last.turnover = (last.turnover ?? 0) + (bar.turnover ?? 0)
    } else {
      out.push({ ...bar, timestamp: key })
    }
  }
  return out
}

const codeOf = (symbol: { ticker: string; market?: unknown }): string =>
  symbolCode({
    ticker: symbol.ticker,
    market: typeof symbol.market === 'string' ? symbol.market : guessCnMarket(symbol.ticker)
  })

/** 回放图表喂数桥：引擎侧持有，loader 注入 klinecharts */
export interface ReplayFeed {
  /** 注入 klinecharts 的数据加载器 */
  loader: DataLoader
  /** 全量替换某标的的可见日 K（开局/换标的/重开/预览换日期） */
  setBars: (code: string, bars: KLineData[]) => void
  /** 引擎完成一个交易日：向当前订阅推送该标的最新 bar（先 setBars 再 pushDay） */
  pushDay: (code: string) => void
}

export const createReplayFeed = (): ReplayFeed => {
  const barsByCode = new Map<string, KLineData[]>()
  let subscriber: { code: string; period: Period; callback: (bar: KLineData) => void } | null = null

  // init 时数据可能在途（换标的后按需拉取）：短暂轮询等待，超时按空处理
  const waitForBars = async (code: string): Promise<KLineData[]> => {
    const deadline = Date.now() + 8000
    for (;;) {
      const bars = barsByCode.get(code)
      if (bars != null) {
        return bars
      }
      if (Date.now() > deadline) {
        return []
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }

  return {
    loader: {
      getBars: async ({ type, symbol, period, callback }) => {
        const code = codeOf(symbol)
        if (type === 'init') {
          const bars = await waitForBars(code)
          callback(aggregateDaily(bars, period), { forward: false, backward: false })
          return
        }
        // 回放无更早历史分页、无未来增量
        callback([], { forward: false, backward: false })
      },
      subscribeBar: ({ symbol, period, callback }) => {
        subscriber = { code: codeOf(symbol), period, callback }
      },
      unsubscribeBar: () => {
        subscriber = null
      }
    },
    setBars: (code, bars) => {
      barsByCode.set(code, bars)
    },
    pushDay: (code) => {
      const sub = subscriber
      if (sub == null || sub.code !== code) {
        return
      }
      const aggregated = aggregateDaily(barsByCode.get(code) ?? [], sub.period)
      const last = aggregated[aggregated.length - 1]
      if (last != null) {
        sub.callback(last)
      }
    }
  }
}
