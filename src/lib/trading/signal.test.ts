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

/** 平盘铺垫日（close 10 / high 10.5 / low 9.5） */
const flat = (i: number) => bar(i, 10, 10.5, 9.5, 10)

/** 强势日：收盘 close、high = close + 0.5、low = close - 0.8（是否站上前日最高由序列构造决定） */
const strong = (i: number, close: number) => bar(i, close - 0.6, close + 0.5, close - 0.8, close)

/** 基准序列：5 根平盘铺垫 + 第 5/6/7 日强涨（11.2 → 12.4 → 13.6，逐日高点过高点、收盘过收盘）→ B@7 */
const baseBars = () => [flat(0), flat(1), flat(2), flat(3), flat(4), strong(5, 11.2), strong(6, 12.4), strong(7, 13.6)]

/** 阴跌日（close 40 − 0.5i，high/low = close ± 0.5）：长下跌铺垫，使 MA30 高悬于价格上方 */
const down = (i: number) => {
  const close = 40 - 0.5 * i
  return bar(i, close - 0.2, close + 0.5, close - 0.5, close)
}

describe('dailySignals（买入：连续 3 日高点过高点、收盘过收盘 → 第 3 日标 B）', () => {
  it('连续 3 日强涨的第 3 日产出买入点（仅一枚）', () => {
    expect(dailySignals(baseBars(), key(0))).toEqual([{ timestamp: ts(7), signal: 'buy' }])
  })

  it('B/S 成对：S 出现前强势段不再续标 B（强势延续只续持）', () => {
    // 第 5~9 日连续强涨（多枚滑动窗口成立），但 B@7 后未出现 S → 仅一枚 B
    const bars = [...baseBars(), strong(8, 14.8), strong(9, 16.2)]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(7), signal: 'buy' }])
  })

  it('窗口内某日最高价未过前日最高（虽收涨）→ 强涨链断，该段不出点', () => {
    // 第 6 日收盘 11.5 > 第 5 日收盘 11.2，但最高 11.6 未过第 5 日最高 11.7 → 链断
    const bars = [
      flat(0),
      flat(1),
      flat(2),
      flat(3),
      flat(4),
      strong(5, 11.2),
      bar(6, 11.0, 11.6, 10.8, 11.5),
      strong(7, 13.6)
    ]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('窗口内某日收盘未过前日收盘（最高虽过）→ 强涨链断，不触发', () => {
    // 第 5 日最高 10.8 > 前日最高 10.5，但收盘 9.9 < 前日收盘 10 → 链断
    const bars = [
      flat(0),
      flat(1),
      flat(2),
      flat(3),
      flat(4),
      bar(5, 9.7, 10.8, 9.5, 9.9),
      strong(6, 11.9),
      strong(7, 13.1)
    ]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('起始日过滤：起始日之前的交易日不出点（历史只作上下文）', () => {
    // 起始日 = 第 7 日：保留 B@7；起始日 = 第 8 日：B@7 被过滤且持仓中无新 B → 空
    expect(dailySignals(baseBars(), key(7))).toEqual([{ timestamp: ts(7), signal: 'buy' }])
    expect(dailySignals(baseBars(), key(8))).toEqual([])
  })

  it('起始日前的强涨不开仓：窗口内无可见 B 时不标 S（B 必须先出现）', () => {
    // 第 5/6/7 日强涨全在起始日（第 8 日）之前；第 8 日暴跌破了「若开仓」的止损基准，
    // 但持仓态未被起始日前的 B 建立 → 不出无主 S
    const bars = [...baseBars(), bar(8, 12.5, 12.8, 11.5, 11.0)]
    expect(dailySignals(bars, key(8))).toEqual([])
  })
})

describe('dailySignals（卖出：B 后先触发者离场，一枚 B 至多一枚 S）', () => {
  it('S1 止损：B 后收盘跌破 B 点前一交易日最低价 → 该日标 S', () => {
    // B@7 的止损基准 = low[6] = 11.6；第 8 日收盘 11.0 跌破 → S@8
    const bars = [...baseBars(), bar(8, 11.2, 11.5, 10.7, 11.0)]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(7), signal: 'buy' },
      { timestamp: ts(8), signal: 'sell' }
    ])
  })

  it('S1 一枚 B 至多一枚 S：离场后继续走低不再标 S', () => {
    const bars = [...baseBars(), bar(8, 11.2, 11.5, 10.7, 11.0), bar(9, 10.8, 11.2, 10.4, 10.5)]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(7), signal: 'buy' },
      { timestamp: ts(8), signal: 'sell' }
    ])
  })

  it('S1 未触发：B 后收盘未破止损基准则不出 S', () => {
    // 第 8/9 日收盘 13.0/13.2 均高于止损基准 11.6，也非 B（未破前日 high）
    const bars = [...baseBars(), bar(8, 12.7, 13.5, 12.5, 13.0), bar(9, 13.0, 13.7, 12.8, 13.2)]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(7), signal: 'buy' }])
  })

  it('S2 趋势离场：B 后连续两日收盘低于 MA30 → 第二日标 S（未破止损时）', () => {
    // 40 根阴跌使 MA30 高悬；第 40/41/42 日强势触发 B@42（止损基准 low[41] = 22.4），
    // 第 42/43 日连续收盘低于 MA30（≈26.6/26.3）但未破止损 → S@43 由 S2 产生
    const bars = [
      ...Array.from({ length: 40 }, (_, i) => down(i)),
      strong(40, 21.8),
      strong(41, 23.2),
      strong(42, 24.6),
      bar(43, 24.3, 25.0, 23.7, 24.5),
      bar(44, 23.8, 24.5, 23.2, 24.0)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(42), signal: 'buy' },
      { timestamp: ts(43), signal: 'sell' }
    ])
  })

  it('S 后空仓待重新武装：下一枚 B 重新开仓，可再出 S', () => {
    // B@7 → S@8（跌破 11.6）；第 9/10/11 日重新强势三日 → B@11
    const bars = [...baseBars(), bar(8, 11.2, 11.5, 10.7, 11.0), strong(9, 12.5), strong(10, 13.7), strong(11, 14.9)]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(7), signal: 'buy' },
      { timestamp: ts(8), signal: 'sell' },
      { timestamp: ts(11), signal: 'buy' }
    ])
  })

  it('B 必须先于 S：无 B 时即使连续跌破 MA30 也不标 S', () => {
    // 42 根阴跌：长期收于 MA30 下方（连续两日条件多次成立），但从未出现 B → 不出 S
    const bars = Array.from({ length: 42 }, (_, i) => down(i))
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('因果性：追加未来 bar 不改变既有信号点（无未来函数）', () => {
    const prefix = dailySignals(baseBars(), key(0))
    // strong8 被成对规则抑制（持仓中不再标 B），flat9 跌破止损 → S@9
    const full = dailySignals([...baseBars(), strong(8, 14.8), flat(9)], key(0))
    expect(full.slice(0, prefix.length)).toEqual(prefix)
  })
})

describe('dailySignals（卖出 S3：持仓期放量 ≥ 前日 3 倍记收盘基准，其后首次连续两日低于基准 → 第二日标 S）', () => {
  /** 可指定成交量的 bar（默认与 bar() 同为 1000） */
  const volBar = (i: number, open: number, high: number, low: number, close: number, volume = 1000): KLineData => ({
    ...bar(i, open, high, low, close),
    volume
  })

  it('B 后放量基准被连续两日跌破 → 第二日标 S（未破止损、S1/S2 不触发）', () => {
    // B@7（止损 11.6）；第 8 日量 3000（=3×前日）收 13.0 记基准；第 9/10 日收 12.5/12.4 连续低于 → S@10
    const bars = [
      ...baseBars(),
      volBar(8, 12.7, 13.3, 12.5, 13.0, 3000),
      volBar(9, 12.8, 13.1, 12.3, 12.5),
      volBar(10, 12.5, 12.8, 12.2, 12.4)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(7), signal: 'buy' },
      { timestamp: ts(10), signal: 'sell' }
    ])
  })

  it('两日不连续（中间收复基准）不触发', () => {
    // 第 9 日低于基准、第 10 日收复（13.2 > 13.0）、第 11 日再低于 → 无连续两日
    const bars = [
      ...baseBars(),
      volBar(8, 12.7, 13.3, 12.5, 13.0, 3000),
      volBar(9, 12.8, 13.1, 12.3, 12.5),
      volBar(10, 12.9, 13.4, 12.6, 13.2),
      volBar(11, 13.0, 13.3, 12.4, 12.6)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(7), signal: 'buy' }])
  })

  it('放量不足 3 倍（2 倍）不记录基准 → 不触发', () => {
    const bars = [
      ...baseBars(),
      volBar(8, 12.7, 13.3, 12.5, 13.0, 2000),
      volBar(9, 12.8, 13.1, 12.3, 12.5),
      volBar(10, 12.5, 12.8, 12.2, 12.4)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(7), signal: 'buy' }])
  })

  it('B 日自身放量同样记录基准，随后两日跌破 → S', () => {
    // 第 7 日（B 日）量 3000 = 3×前日 → 基准 = B 日收盘 13.6；第 8/9 日收 13.0/12.8 连续低于 → S@9
    const bars = [
      flat(0),
      flat(1),
      flat(2),
      flat(3),
      flat(4),
      strong(5, 11.2),
      strong(6, 12.4),
      volBar(7, 13.0, 14.1, 12.8, 13.6, 3000),
      volBar(8, 13.2, 13.8, 12.9, 13.0),
      volBar(9, 12.9, 13.3, 12.6, 12.8)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(7), signal: 'buy' },
      { timestamp: ts(9), signal: 'sell' }
    ])
  })

  it('空仓时（无 B）放量破位不标 S（B 必须先出现）', () => {
    const bars = [
      flat(0),
      flat(1),
      flat(2),
      flat(3),
      flat(4),
      flat(5),
      volBar(6, 9.8, 10.6, 9.6, 10.2, 3000),
      volBar(7, 10.0, 10.3, 9.7, 9.8),
      volBar(8, 9.7, 10.0, 9.4, 9.6)
    ]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('空仓期（B 前）放量不记录：B 后两日低于该旧放量收盘也不触发', () => {
    // 第 5 日空仓放量 3000 收 13.0 → 不记录；回调后第 7/8/9 日三日强涨 B@9（止损 11.6）；
    // 第 10/11 日收 12.6/12.5（低于旧放量收盘 13.0 但高于止损）→ 无 S
    const bars = [
      flat(0),
      flat(1),
      flat(2),
      flat(3),
      flat(4),
      volBar(5, 12.7, 13.3, 12.5, 13.0, 3000),
      volBar(6, 11.3, 11.5, 10.7, 11.0),
      strong(7, 11.2),
      strong(8, 12.4),
      strong(9, 13.6),
      volBar(10, 13.2, 13.6, 12.4, 12.6),
      volBar(11, 12.5, 12.8, 12.2, 12.5)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(9), signal: 'buy' }])
  })

  it('S 离场时基准复位：旧放量收盘不带入下一对 B/S', () => {
    // B@7 → 第 8 日放量 3000 收 13.0 记基准 → 第 9 日跌破止损 S@9（基准复位）；
    // 第 10/11/12 日三日强涨 B@12 → 第 13/14 日收 12.6/12.5 低于旧基准 13.0 但不再触发
    const bars = [
      ...baseBars(),
      volBar(8, 12.7, 13.3, 12.5, 13.0, 3000),
      volBar(9, 11.2, 11.9, 10.8, 11.0),
      strong(10, 11.5),
      strong(11, 12.7),
      strong(12, 13.9),
      volBar(13, 13.0, 13.4, 12.4, 12.6),
      volBar(14, 12.5, 12.8, 12.2, 12.5)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(7), signal: 'buy' },
      { timestamp: ts(9), signal: 'sell' },
      { timestamp: ts(12), signal: 'buy' }
    ])
  })
})
