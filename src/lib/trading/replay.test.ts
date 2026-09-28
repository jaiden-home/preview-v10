import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { dayKeyOf, createInitialAccount, executeBuy } from './account'
import {
  advanceDay,
  calendarFrom,
  createReplaySession,
  forwardCountOf,
  replayQuoteOf,
  releaseAllFrozen,
  startRangeOf,
  virtualTsOf,
  visibleDailyBarsOf,
  type ReplayState
} from './replay'
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
  const state = (over: Partial<ReplayState>): ReplayState => ({
    status: 'running',
    speedMs: 30_000,
    anchorCode: 'sh600519',
    startDate: '2023-06-01',
    dayCount: 3,
    dayIndex: 1,
    ...over
  })

  it('开局：第 1 个交易日立即完成', () => {
    const session = createReplaySession('sh600519', '2023-06-01', 10)
    expect(session.status).toBe('running')
    expect(session.dayIndex).toBe(1)
    expect(session.speedMs).toBe(30_000)
    expect(session.dayCount).toBe(10)
  })

  it('推进：dayIndex 递增；走满置 ended；非 running 不动', () => {
    expect(advanceDay(state({ dayIndex: 1 })).dayIndex).toBe(2)
    const ended = advanceDay(state({ dayIndex: 3 }))
    expect(ended.status).toBe('ended')
    expect(ended.dayIndex).toBe(3)
    expect(advanceDay(ended)).toBe(ended)
    expect(advanceDay(state({ status: 'paused' })).status).toBe('paused')
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

describe('窗口与起始日范围', () => {
  const dates = tradingDates(503)
  const bars = dates.map((date, i) => bar(date, 10 + i, 11 + i, 9 + i, 10.5 + i))

  it('日历与可模拟天数自起始日（含）起算', () => {
    const calendar = calendarFrom(bars, dates[3])
    expect(calendar).toHaveLength(500)
    expect(calendar[0]).toBe(dates[3])
    expect(forwardCountOf(bars, dates[3])).toBe(500)
    expect(forwardCountOf(bars, dates[502])).toBe(1)
  })

  it('可选起始日范围：min 保证满 500 天、max 至少留 1 天', () => {
    const range = startRangeOf(bars)!
    expect(range).not.toBeNull()
    expect(forwardCountOf(bars, range.min)).toBeGreaterThanOrEqual(500)
    expect(forwardCountOf(bars, range.max)).toBeGreaterThanOrEqual(1)
    expect(startRangeOf(bars.slice(0, 2))).toBeNull()
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
