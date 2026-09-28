import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chart, KLineData } from 'klinecharts'
import { createDataLoader } from './data-loader'
import { timeShareState } from './timeshare'

const defaultSymbol = { ticker: '600519', pricePrecision: 2, volumePrecision: 0, market: 'sh' }

// BFF 分时快照（服务端已解析）：最新交易日 2 根有效分钟点，昨收/日开高低来自 qt
const timeShareSnapshot = {
  date: '20260914',
  prevClose: 1275.16,
  open: 1277.27,
  high: 1284.5,
  low: 1273.2,
  bars: [
    {
      timestamp: new Date('2026-09-14T09:30').getTime(),
      open: 1275.16,
      high: 1277.27,
      low: 1277.27,
      close: 1277.27,
      volume: 133,
      turnover: 16987691.06
    },
    {
      timestamp: new Date('2026-09-14T09:31').getTime(),
      open: 1277.27,
      high: 1283.89,
      low: 1283.89,
      close: 1283.89,
      volume: 556,
      turnover: 71219510.09
    }
  ]
}

const makeLoader = (initial?: { code: string; bars: KLineData[] }) => {
  const chart = { setPeriod: vi.fn() }
  const deps = {
    chart: chart as unknown as Chart,
    applyTimeShareTransforms: vi.fn(),
    calibrateTimeShareFit: vi.fn(),
    fitTimeShareBars: vi.fn(),
    syncTimeShareLastPriceMark: vi.fn(),
    initial: initial ?? null
  }
  return { loader: createDataLoader(deps), deps, chart }
}

const stubFetch = (impl: (url: string) => Promise<unknown>) => {
  const fetchMock = vi.fn(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const jsonFetch = (payload: unknown) => stubFetch(async () => ({ ok: true, json: async () => payload }))

describe('数据加载器（BFF 版）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.location.hash = ''
    timeShareState.active = false
    timeShareState.prevClose = Number.NaN
    timeShareState.dayOpen = Number.NaN
    timeShareState.dayHigh = Number.NaN
    timeShareState.dayLow = Number.NaN
    timeShareState.dayKey = null
    timeShareState.lotSize = 100
    timeShareState.isIndex = false
  })

  it('分时 init：注入数据、同步状态并同帧应用形态与校准', async () => {
    const fetchMock = jsonFetch(timeShareSnapshot)
    try {
      const { loader, deps } = makeLoader()
      const callback = vi.fn()
      timeShareState.active = true
      await loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: defaultSymbol,
        period: { span: 1, type: 'minute' },
        callback
      })
      expect(callback).toHaveBeenCalledWith(timeShareSnapshot.bars, false)
      expect(timeShareState.dayKey).toBe('20260914')
      expect(timeShareState.prevClose).toBe(1275.16)
      expect(timeShareState.dayOpen).toBe(1277.27)
      expect(timeShareState.dayHigh).toBe(1284.5)
      expect(timeShareState.dayLow).toBe(1273.2)
      expect(deps.applyTimeShareTransforms).toHaveBeenCalledTimes(1)
      expect(deps.calibrateTimeShareFit).toHaveBeenCalledWith(2)
      expect(deps.fitTimeShareBars).toHaveBeenCalledWith(2)
      // 注入前同步最新价标线颜色（现价 vs 昨收）
      expect(deps.syncTimeShareLastPriceMark).toHaveBeenCalledWith(1283.89)
      // 请求打到 BFF 分时口
      expect(fetchMock.mock.calls[0][0]).toContain('/api/timeshare?symbol=sh600519')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('分时加载失败时也切到分时形态并回调空数据', async () => {
    stubFetch(async () => {
      throw new Error('network error')
    })
    try {
      const { loader, deps } = makeLoader()
      const callback = vi.fn()
      timeShareState.active = true
      await loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: defaultSymbol,
        period: { span: 1, type: 'minute' },
        callback
      })
      expect(callback).toHaveBeenCalledWith([], false)
      // 失败同样切到分时形态，与普通周期加载失败后的空网格表现一致
      expect(deps.applyTimeShareTransforms).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('加载期间切走周期后放弃注入分时数据与形态', async () => {
    jsonFetch(timeShareSnapshot)
    try {
      const { loader, deps } = makeLoader()
      const callback = vi.fn()
      timeShareState.active = true
      const pending = loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: defaultSymbol,
        period: { span: 1, type: 'minute' },
        callback
      })
      // 数据在途时用户切走分时
      timeShareState.active = false
      await pending
      expect(callback).toHaveBeenCalledWith([], false)
      // 不再应用分时形态，避免污染新周期
      expect(deps.applyTimeShareTransforms).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('分时 forward/backward 均返回空且无更多，杜绝与 offset 调整联动的重入死循环', async () => {
    const fetchMock = jsonFetch(timeShareSnapshot)
    try {
      const { loader } = makeLoader()
      const moreCallback = vi.fn()
      timeShareState.active = true
      for (const loadType of ['forward', 'backward'] as const) {
        await loader.getBars({
          type: loadType,
          timestamp: 1,
          symbol: defaultSymbol,
          period: { span: 1, type: 'minute' },
          callback: moreCallback
        })
      }
      expect(moreCallback).toHaveBeenCalledTimes(2)
      expect(moreCallback).toHaveBeenCalledWith([], { forward: false, backward: false })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('SSR 注入的首屏日 K 直接回调，免首轮网络请求', async () => {
    const fetchMock = jsonFetch({ bars: [] })
    try {
      const bars: KLineData[] = []
      const { loader } = makeLoader({ code: 'sh600519', bars })
      const callback = vi.fn()
      await loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: defaultSymbol,
        period: { span: 1, type: 'day' },
        callback
      })
      expect(callback).toHaveBeenCalledWith(bars, true)
      expect(fetchMock).not.toHaveBeenCalled()
      // 仅消费一次：再次 init 走网络
      await loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: defaultSymbol,
        period: { span: 1, type: 'day' },
        callback
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('普通周期 init 经 BFF 拉取并按 more=true 回调', async () => {
    const bars = [{ timestamp: 1, open: 1, close: 1, high: 1, low: 1, volume: 1 }]
    const fetchMock = jsonFetch({ bars })
    try {
      const { loader } = makeLoader()
      const callback = vi.fn()
      await loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: defaultSymbol,
        period: { span: 1, type: 'day' },
        callback
      })
      expect(callback).toHaveBeenCalledWith(bars, true)
      const url = fetchMock.mock.calls[0][0] as string
      expect(url).toContain('/api/kline?symbol=sh600519')
      expect(url).toContain('period=1d')
      expect(url).toContain('from=')
      expect(url).toContain('to=')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('分时轮询：首次更新发射最新一根，未变化跳过，跨交易日触发整体重载', async () => {
    vi.useFakeTimers()
    jsonFetch(timeShareSnapshot)
    try {
      const { loader, deps } = makeLoader()
      const callback = vi.fn()
      timeShareState.active = true
      loader.subscribeBar!({
        symbol: defaultSymbol,
        period: { span: 1, type: 'minute' },
        callback
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ close: 1283.89, volume: 556 }))
      // 轮询发射后同步最新价标线颜色
      expect(deps.syncTimeShareLastPriceMark).toHaveBeenCalledWith(1283.89)
      // 同数据第二次轮询不再发射
      await vi.advanceTimersByTimeAsync(3000)
      expect(callback).toHaveBeenCalledTimes(1)
      expect(deps.syncTimeShareLastPriceMark).toHaveBeenCalledTimes(1)
      // 跨交易日：dayKey 变化触发 setPeriod 整体重载
      timeShareState.dayKey = '20260911'
      await vi.advanceTimersByTimeAsync(3000)
      expect(deps.chart.setPeriod).toHaveBeenCalledWith({ span: 1, type: 'minute' })
      loader.unsubscribeBar!({ symbol: defaultSymbol, period: { span: 1, type: 'minute' } })
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
