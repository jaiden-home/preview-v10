import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { dayKeyOf, createInitialAccount, executeBuy } from './account'
import {
  REPLAY_SPEED_MS,
  REPLAY_SPEED_PRESETS_MS,
  calendarFrom,
  createReplaySession,
  nearestSpeedPresetMs,
  replayFundamentalOf,
  replayQuoteOf,
  releaseAllFrozen,
  splitReplayView,
  virtualTsOf,
  visibleDailyBarsOf
} from './replay'
import type { QuoteSnapshot } from '../chart/types'
const bar = (date: string, open: number, high: number, low: number, close: number): KLineData => {
  const [y, m, d] = date.split('-').map(Number)
  return { timestamp: new Date(y, m - 1, d).getTime(), open, high, low, close, volume: 1000 }
}

/** 连续交易日序列（跳过周末，2023-06-01 为周四） */
const tradingDates = (count: number, start = '2023-06-01'): string[] => {
  const [y, m, d] = start.split('-').map(Number)
  const dates: string[] = []
  const cursor = new Date(y, m - 1, d)
  while (dates.length < count) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) {
      dates.push(dayKeyOf(cursor.getTime()))
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

describe('日原子状态机', () => {
  it('开局：第 1 个交易日立即完成', () => {
    const session = createReplaySession('sh600519', '2023-06-01', 10)
    expect(session.status).toBe('running')
    expect(session.dayIndex).toBe(1)
    expect(session.speedMs).toBe(10_000)
    expect(session.dayCount).toBe(10)
  })

  it('开局可带倍速：speedMs 档位直传生效', () => {
    expect(createReplaySession('sh600519', '2023-06-01', 10, 30_000).speedMs).toBe(30_000)
  })

  it('倍速档位：3/5/10/15/30/60 秒，反查就近命中', () => {
    expect(REPLAY_SPEED_PRESETS_MS).toEqual([3_000, 5_000, REPLAY_SPEED_MS, 15_000, 30_000, 60_000])
    for (const presetMs of REPLAY_SPEED_PRESETS_MS) {
      expect(nearestSpeedPresetMs(presetMs)).toBe(presetMs)
    }
    // 非档位值取就近档
    expect(nearestSpeedPresetMs(2_000)).toBe(3_000)
    expect(nearestSpeedPresetMs(40_000)).toBe(30_000)
  })

  it('virtualTsOf 与 dayKeyOf 回环一致（下单落账即虚拟日期）', () => {
    expect(dayKeyOf(virtualTsOf('2023-06-15'))).toBe('2023-06-15')
  })

  it('releaseAllFrozen：开局前真实日期建仓的冻结全部转为可卖', () => {
    const account = executeBuy(createInitialAccount(), {
      code: 'sh600519',
      name: '贵州茅台',
      price: 100,
      qty: 200,
      ts: Date.now()
    })
    expect(account.positions[0]!.frozenQty).toBe(200)
    const released = releaseAllFrozen(account)
    expect(released.positions[0]!.availableQty).toBe(200)
    expect(released.positions[0]!.frozenQty).toBe(0)
    expect(released.cash).toBe(account.cash)
    // 无冻结时原样返回
    expect(releaseAllFrozen(released)).toBe(released)
  })
})

describe('窗口与日历', () => {
  const dates = tradingDates(503)
  const bars = dates.map((date, i) => bar(date, 10 + i, 11 + i, 9 + i, 10.5 + i))

  it('日历自起始日（含）起算', () => {
    const calendar = calendarFrom(bars, dates[3])
    expect(calendar).toHaveLength(500)
    expect(calendar[0]).toBe(dates[3])
  })

  it('结束日（含）截断：日历按区间计；早于起始日为空区间', () => {
    const calendar = calendarFrom(bars, dates[3], dates[52])
    expect(calendar).toHaveLength(50)
    expect(calendar[0]).toBe(dates[3])
    expect(calendar[calendar.length - 1]).toBe(dates[52])
    expect(calendarFrom(bars, dates[3], dates[2])).toEqual([])
  })

  it('回放视图切分：history 取起始日前末尾 200 根；simDays = [startDate, endDay]（含两端）', () => {
    const { history, simDays } = splitReplayView(bars, dates[3], dates[52])
    expect(simDays).toHaveLength(50)
    expect(simDays[0]).toEqual(bars[3])
    expect(simDays[49]).toEqual(bars[52])
    expect(history).toHaveLength(3) // 起始日前仅 3 根
    expect(history[0]).toEqual(bars[0])
  })

  it('回放视图切分：历史超过 200 根时截末尾 200', () => {
    const { history, simDays } = splitReplayView(bars, dates[502], dates[502])
    expect(history).toHaveLength(200) // 502 根历史 → 末尾 200
    expect(history[0]).toEqual(bars[302])
    expect(simDays).toHaveLength(1)
  })
})

describe('行情与可见日 K（多标的对齐、停牌回退）', () => {
  // 共享日历三日；该标的 06-02 停牌（无 K 线）
  const calendar = ['2023-06-01', '2023-06-02', '2023-06-03']
  const bars = [
    bar('2023-05-31', 10, 10, 10, 10),
    bar('2023-06-01', 10, 11, 9, 10.5),
    bar('2023-06-03', 10.5, 12, 10, 11)
  ]

  it('最新完成日收盘为现价，前一日收盘为昨收', () => {
    expect(replayQuoteOf(bars, 1, calendar)).toEqual({ price: 10.5, prevClose: 10 })
  })

  it('停牌日沿用停牌前收盘（价不动），复牌日昨收 = 停牌前收盘', () => {
    const suspended = replayQuoteOf(bars, 2, calendar)!
    expect(suspended.price).toBe(10.5)
    const resumed = replayQuoteOf(bars, 3, calendar)!
    expect(resumed.price).toBe(11)
    expect(resumed.prevClose).toBe(10.5)
  })

  it('未开始（dayIndex=0）：市场停在起始日之前', () => {
    const preview = replayQuoteOf(bars, 0, calendar)!
    expect(preview.price).toBe(10)
  })

  it('可见日 K = 历史 + 已完成模拟日', () => {
    expect(visibleDailyBarsOf(bars, 0, calendar)).toHaveLength(1)
    expect(visibleDailyBarsOf(bars, 2, calendar)).toHaveLength(2)
    expect(visibleDailyBarsOf(bars, 3, calendar)).toHaveLength(3)
  })

  it('未上市/空数据/越界返回空', () => {
    expect(replayQuoteOf(bars, 1, ['2023-05-01'])).toBeNull()
    expect(replayQuoteOf([], 1, calendar)).toBeNull()
    expect(replayQuoteOf(bars, 1, [])).toBeNull()
    expect(visibleDailyBarsOf(bars, 1, ['2023-05-01'])).toHaveLength(0)
  })
})

describe('回放基本面（现价比例回溯 + 当日精确推算）', () => {
  const volBar = (date: string, open: number, high: number, low: number, close: number, volume: number): KLineData => ({
    ...bar(date, open, high, low, close),
    volume
  })
  const quoteOf = (over: Partial<QuoteSnapshot>): QuoteSnapshot => ({
    market: 'sh',
    ticker: '600999',
    name: null,
    price: 10,
    prevClose: 9.9,
    fundamental: {
      pe: 20,
      peDynamic: 18,
      peStatic: 22,
      pb: 2,
      totalMarketCap: 100e8,
      floatMarketCap: 80e8,
      avgPrice: 10.1,
      turnoverRate: 3,
      amplitude: 5
    },
    ...over
  })
  const bars = [volBar('2024-01-01', 9.5, 10.5, 9.4, 10, 800), volBar('2024-01-02', 10, 12, 11, 12, 1000)]

  it('市值/市盈/市净/均价按「回放末日收盘 / 现价」比例回溯', () => {
    const f = replayFundamentalOf(quoteOf({}), bars)
    // ratio = 12 / 10 = 1.2
    expect(f.pe).toBeCloseTo(24)
    expect(f.peDynamic).toBeCloseTo(21.6)
    expect(f.peStatic).toBeCloseTo(26.4)
    expect(f.pb).toBeCloseTo(2.4)
    expect(f.totalMarketCap).toBeCloseTo(120e8)
    expect(f.floatMarketCap).toBeCloseTo(96e8)
    expect(f.avgPrice).toBeCloseTo(12.12)
  })

  it('振幅 = 末日 (高-低)/昨收（前一根收盘），当日精确、与快照振幅无关', () => {
    const f = replayFundamentalOf(quoteOf({}), bars)
    expect(f.amplitude).toBeCloseTo(((12 - 11) / 10) * 100)
  })

  it('换手率 = 末日量 × 100 股 / 流通股本（主板量为手口径）', () => {
    const f = replayFundamentalOf(quoteOf({}), bars)
    // 流通股本 = 80e8 / 10 = 8e8 股；1000 手 = 1e5 股
    expect(f.turnoverRate).toBeCloseTo((1e5 / 8e8) * 100)
  })

  it('科创板量为股口径（不乘 100）', () => {
    const star = quoteOf({ market: 'sh', ticker: '688981' })
    const f = replayFundamentalOf(star, bars)
    expect(f.turnoverRate).toBeCloseTo((1000 / 8e8) * 100)
  })

  it('首根无前收：振幅退回以开盘为基准', () => {
    const f = replayFundamentalOf(quoteOf({}), [volBar('2024-01-02', 10, 12, 11, 12, 1000)])
    expect(f.amplitude).toBeCloseTo(((12 - 11) / 10) * 100)
  })

  it('bars 为空返回 {}；现价缺失时仅振幅可得', () => {
    expect(replayFundamentalOf(quoteOf({}), [])).toEqual({})
    const f = replayFundamentalOf(quoteOf({ price: null }), bars)
    expect(f.amplitude).toBeCloseTo(10)
    expect(f.pe).toBeUndefined()
    expect(f.turnoverRate).toBeUndefined()
  })

  it('流通市值/量为零或缺失时换手率缺数（指数等无流通市值标的）', () => {
    const f = replayFundamentalOf(quoteOf({ fundamental: { floatMarketCap: undefined } }), bars)
    expect(f.turnoverRate).toBeUndefined()
    expect(f.pe).toBeUndefined()
  })
})
