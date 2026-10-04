import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { dayKeyOf } from './account'
import { dailySignals } from './signal'

/** 连续交易日 bar（时间戳逐日 +1 天） */
const bar = (i: number, open: number, high: number, low: number, close: number): KLineData => ({
  timestamp: new Date(2024, 0, 2 + i).getTime(),
  open,
  high,
  low,
  close,
  volume: 1000
})

const ts = (i: number) => new Date(2024, 0, 2 + i).getTime()
const key = (i: number) => dayKeyOf(ts(i))

/** 平盘铺垫日（close 10 / high 10.5） */
const flat = (i: number) => bar(i, 10, 10.5, 9.5, 10)

/** 强势日：收盘 close、high = close + 0.5（是否站上前日最高由序列构造决定） */
const strong = (i: number, close: number) => bar(i, close - 0.6, close + 0.5, close - 0.8, close)

/** 基准序列：5 根平盘铺垫 + 第 5/6/7 日强势（11.2 → 12.4 → 13.6，逐日收盘均破前日 high） */
const baseBars = () => [flat(0), flat(1), flat(2), flat(3), flat(4), strong(5, 11.2), strong(6, 12.4), strong(7, 13.6)]

describe('dailySignals（买入规则：连续 3 日收盘均破前日最高 → 第 3 日标 B）', () => {
  it('连续 3 日强势的第 3 日产出买入点（仅一枚）', () => {
    expect(dailySignals(baseBars(), key(0))).toEqual([{ timestamp: ts(7), signal: 'buy' }])
  })

  it('滑动窗口：强势段超过 3 日时，第 3 日起每个构成完整窗口的交易日各标一枚 B', () => {
    const bars = [...baseBars(), strong(8, 14.8)]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(7), signal: 'buy' },
      { timestamp: ts(8), signal: 'buy' }
    ])
  })

  it('窗口内某日收盘未破前日最高（强势中断）→ 该段不出点', () => {
    // 第 6 日收盘 11.5 未破第 5 日 high 11.7（虽收涨），第 7 日重启强势也构不成 3 日窗口
    const bars = [
      flat(0),
      flat(1),
      flat(2),
      flat(3),
      flat(4),
      strong(5, 11.2),
      bar(6, 10.9, 12.0, 10.7, 11.5),
      strong(7, 13.6)
    ]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('仅收涨但未站上前一日最高价（close ≤ 前日 high）不触发', () => {
    // 第 5 日收 10.3 > 前收 10（收涨）但 ≤ 前日 high 10.5
    const bars = [
      flat(0),
      flat(1),
      flat(2),
      flat(3),
      flat(4),
      bar(5, 9.8, 10.8, 9.6, 10.3),
      strong(6, 11.9),
      strong(7, 13.1)
    ]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('起始日过滤：起始日之前的交易日不出点（历史只作上下文）', () => {
    const bars = [...baseBars(), strong(8, 14.8)]
    // 起始日 = 第 7 日：仅保留 ts7/ts8；起始日 = 第 8 日：仅保留 ts8
    expect(dailySignals(bars, key(7))).toEqual([
      { timestamp: ts(7), signal: 'buy' },
      { timestamp: ts(8), signal: 'buy' }
    ])
    expect(dailySignals(bars, key(8))).toEqual([{ timestamp: ts(8), signal: 'buy' }])
  })

  it('因果性：追加未来 bar 不改变既有信号点（无未来函数）', () => {
    const prefix = dailySignals(baseBars(), key(0))
    const full = dailySignals([...baseBars(), strong(8, 14.8), flat(9)], key(0))
    expect(full.slice(0, prefix.length)).toEqual(prefix)
  })
})
