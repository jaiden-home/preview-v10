import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { dayKeyOf, createInitialAccount, executeBuy } from './account'
import {
  calendarFrom,
  createReplaySession,
  replayQuoteOf,
  releaseAllFrozen,
  splitReplayView,
  virtualTsOf,
  visibleDailyBarsOf
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
  it('开局：第 1 个交易日立即完成', () => {
    const session = createReplaySession('sh600519', '2023-06-01', 10)
    expect(session.status).toBe('running')
    expect(session.dayIndex).toBe(1)
    expect(session.speedMs).toBe(10_000)
    expect(session.dayCount).toBe(10)
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

  it('回放视图切分：history 取起始日前末尾 500 根；simDays = [startDate, endDay]（含两端）', () => {
    const { history, simDays } = splitReplayView(bars, dates[3], dates[52])
    expect(simDays).toHaveLength(50)
    expect(simDays[0]).toEqual(bars[3])
    expect(simDays[49]).toEqual(bars[52])
    expect(history).toHaveLength(3) // 起始日前仅 3 根
    expect(history[0]).toEqual(bars[0])
  })

  it('回放视图切分：历史超过 500 根时截末尾 500', () => {
    const { history, simDays } = splitReplayView(bars, dates[502], dates[502])
    expect(history).toHaveLength(500) // 502 根历史 → 末尾 500
    expect(history[0]).toEqual(bars[2])
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
