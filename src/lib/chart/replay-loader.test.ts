import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { aggregateDaily, createReplayFeed } from './replay-loader'

const bar = (date: string, open: number, high: number, low: number, close: number, volume = 100): KLineData => {
  const [y, m, d] = date.split('-').map(Number)
  return { timestamp: new Date(y, m - 1, d).getTime(), open, high, low, close, volume, turnover: volume * close }
}

describe('aggregateDaily（日 K → 周/月聚合）', () => {
  // 2023-06-01（四）/ 06-02（五）属同一周（周一 05-29）；06-05（一）起新周；06-01 与 07-03 跨月
  const bars = [
    bar('2023-06-01', 10, 11, 9, 10.5),
    bar('2023-06-02', 10.5, 12, 10, 11),
    bar('2023-06-05', 11, 11.5, 9.5, 10.8)
  ]

  it('周聚合：桶时间戳=周一，open/close 取首末，高低量额合并', () => {
    const weekly = aggregateDaily(bars, { span: 1, type: 'week' })
    expect(weekly).toHaveLength(2)
    const first = weekly[0]!
    expect(new Date(first.timestamp).getDate()).toBe(29) // 2023-05-29 周一
    expect(first.open).toBe(10)
    expect(first.close).toBe(11)
    expect(first.high).toBe(12)
    expect(first.low).toBe(9)
    expect(first.volume).toBe(200)
    expect(weekly[1]!.close).toBe(10.8)
  })

  it('月聚合：按自然月分桶', () => {
    const monthly = aggregateDaily([...bars, bar('2023-07-03', 10.8, 13, 10.6, 12)], { span: 1, type: 'month' })
    expect(monthly).toHaveLength(2)
    expect(monthly[0]!.close).toBe(10.8)
    expect(monthly[1]!.open).toBe(10.8)
  })

  it('日周期原样返回；分钟等周期返回空', () => {
    expect(aggregateDaily(bars, { span: 1, type: 'day' })).toBe(bars)
    expect(aggregateDaily(bars, { span: 1, type: 'minute' })).toHaveLength(0)
  })
})

describe('createReplayFeed（DataLoader 喂数桥）', () => {
  const bars = [bar('2023-06-01', 10, 11, 9, 10.5), bar('2023-06-02', 10.5, 12, 10, 11)]
  const symbol = { ticker: '600519', market: 'sh', pricePrecision: 2, volumePrecision: 0 }
  const dayPeriod = { span: 1, type: 'day' } as const

  it('init 供应聚合数据；forward 无更多', async () => {
    const feed = createReplayFeed()
    feed.setBars('sh600519', bars)
    const received: Array<{ data: KLineData[]; more: unknown }> = []
    await feed.loader.getBars({
      type: 'init',
      symbol,
      period: dayPeriod,
      timestamp: null,
      callback: (data, more) => received.push({ data, more })
    })
    expect(received[0]!.data).toHaveLength(2)
    expect(received[0]!.more).toEqual({ forward: false, backward: false })
    await feed.loader.getBars({
      type: 'forward',
      symbol,
      period: dayPeriod,
      timestamp: bars[0]!.timestamp,
      callback: (data, more) => received.push({ data, more })
    })
    expect(received[1]!.data).toHaveLength(0)
  })

  it('pushDay 推送最新 bar 到当前订阅；非订阅标的不推送', () => {
    const feed = createReplayFeed()
    feed.setBars('sh600519', bars)
    let pushed: KLineData | null = null
    feed.loader.subscribeBar?.({ symbol, period: dayPeriod, callback: (data) => (pushed = data) })
    feed.setBars('sh600519', [...bars, bar('2023-06-05', 11, 11.5, 9.5, 10.8)])
    feed.pushDay('sh600519')
    expect(pushed!.close).toBe(10.8)
    feed.pushDay('sz000001')
    expect(pushed!.close).toBe(10.8)
    feed.loader.unsubscribeBar?.({ symbol, period: dayPeriod })
  })
})
