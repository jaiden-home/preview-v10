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

/** 平盘铺垫日（close 10 / high 10.5 / low 9.5）；30 根供 MA30 成形 */
const flat = (i: number) => bar(i, 10, 10.5, 9.5, 10)
const flats = (n: number) => Array.from({ length: n }, (_, i) => flat(i))

/** 强涨日：收盘 close、high = close + 0.5、low = close - 0.8（是否过前日高/收由序列构造决定） */
const strong = (i: number, close: number) => bar(i, close - 0.6, close + 0.5, close - 0.8, close)

/** 可指定成交量的 bar（默认与 bar() 同为 1000） */
const volBar = (i: number, open: number, high: number, low: number, close: number, volume = 1000): KLineData => ({
  ...bar(i, open, high, low, close),
  volume
})

/**
 * 基准序列：30 根平盘 + 第 30/31/32 日强涨（11.2 → 12.4 → 13.6）→ B@32：
 * 三日高点过高点、收盘过收盘；第 3 日收盘 13.6 ≥ MA30@32 ≈ 10.24；
 * 三日等量（无缩量）不触发动能保护。止损基准 = low[31] = 11.6。
 */
const baseBars = () => [...flats(30), strong(30, 11.2), strong(31, 12.4), strong(32, 13.6)]

/** 阴跌日（close 40 − 0.5i，high/low = close ± 0.5）：长下跌铺垫，使 MA30 高悬于价格上方 */
const down = (i: number) => {
  const close = 40 - 0.5 * i
  return bar(i, close - 0.2, close + 0.5, close - 0.5, close)
}

describe('dailySignals（买入：连续 3 日高点过高点、收盘过收盘 + 第 3 日收盘 ≥ MA30 + 动能保护（R1 的 50% > R2+R3 或 R2 的 15% > R3 即拦））', () => {
  it('三项条件齐备的第 3 日产出买入点（仅一枚）', () => {
    expect(dailySignals(baseBars(), key(0))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
  })

  it('B/S 成对：S 出现前强势段不再续标 B（强势延续只续持）', () => {
    // 第 30~34 日连续强涨（多枚滑动窗口成立），但 B@32 后未出现 S → 仅一枚 B
    const bars = [...baseBars(), strong(33, 14.8), strong(34, 16.2)]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
  })

  it('窗口内某日最高价未过前日最高（虽收涨）→ 强涨链断，该段不出点', () => {
    // 第 31 日收盘 11.5 > 第 30 日收盘 11.2，但最高 11.6 低于第 30 日最高 11.7 → 链断
    const bars = [...flats(30), strong(30, 11.2), bar(31, 11.0, 11.6, 10.8, 11.5), strong(32, 13.6)]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('窗口内某日最高价与前日持平（平高亦算）→ 链保持，第 3 日出 B', () => {
    // 第 31 日最高 11.7 == 第 30 日最高 11.7（收盘 11.5 > 11.2 仍收涨）→ 平高不断链；
    // 动能 R2+R3 = 20.9% ≥ 6%、R3 = 18.3% ≥ 0.4%、收盘 13.6 ≥ MA30 ≈ 10.5 → B@32
    const bars = [...flats(30), strong(30, 11.2), bar(31, 11.0, 11.7, 10.8, 11.5), strong(32, 13.6)]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
  })

  it('窗口内某日最高价低于前日但在 0.1% 容差内 → 链保持，第 3 日出 B', () => {
    // 第 31 日最高 11.69 低于第 30 日最高 11.7，但 ≥ 11.7×0.999 ≈ 11.6883 → 容差内不断链 → B@32
    const bars = [...flats(30), strong(30, 11.2), bar(31, 11.0, 11.69, 10.8, 11.5), strong(32, 13.6)]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
  })

  it('窗口内某日收盘未过前日收盘（最高虽过）→ 强涨链断，不触发', () => {
    // 第 30 日最高 10.8 > 前日最高 10.5，但收盘 9.9 < 前日收盘 10 → 链断
    const bars = [...flats(30), bar(30, 9.7, 10.8, 9.5, 9.9), strong(31, 11.9), strong(32, 13.1)]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('涨速衰竭（R3 < R2 的 15%）不触发（动能保护②-b）', () => {
    // R1 = 1.0%、R2 = 11.98%、R3 = 0.115%：R2 的 15% = 1.797% > R3 → 衰竭，不开仓
    const bars = [
      ...flats(30),
      bar(30, 9.9, 10.6, 9.8, 10.1),
      volBar(31, 10.7, 11.8, 10.6, 11.31, 2000),
      volBar(32, 11.3, 11.95, 11.2, 11.323, 1500)
    ]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('涨速收窄、R3 恰为 R2 的 15% 触发（≥ 含等于，且 R2+R3 ≥ 50%×R1）', () => {
    // R1 = 1.0%、R2 = 11.98%、R3 = 1.797%：R3 ≈ 0.15×R2（≥ 含等于）；
    // R2+R3 = 13.78% ≥ 0.5%×R1 = 0.5% → B@32
    const bars = [
      ...flats(30),
      bar(30, 9.9, 10.6, 9.8, 10.1),
      volBar(31, 10.7, 11.8, 10.6, 11.31, 2000),
      volBar(32, 11.35, 11.95, 11.3, 11.5133, 1500)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
  })

  it('第 3 日涨速不降（R3 ≥ R2）天然满足 → 触发', () => {
    // R1 = 1.0%、R2 = 11.98%、R3 = 14.06%：两条件均过 → B@32
    const bars = [
      ...flats(30),
      bar(30, 9.9, 10.6, 9.8, 10.1),
      volBar(31, 10.7, 11.8, 10.6, 11.31, 2000),
      volBar(32, 12.1, 12.95, 12.0, 12.9, 1500)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
  })

  it('涨速收窄虽放量（量 ≥ 第 2 日）同样受限 → 不触发', () => {
    // R1 = 1.0%、R2 = 11.98%、R3 = 0.80%：放量不豁免，R2 的 15% = 1.797% > R3 → 不开仓
    const bars = [
      ...flats(30),
      bar(30, 9.9, 10.6, 9.8, 10.1),
      volBar(31, 10.7, 11.8, 10.6, 11.31, 2000),
      volBar(32, 11.35, 11.9, 11.25, 11.4, 2500)
    ]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('后两日合计接不回首日涨幅一半（R1 的 50% > R2+R3）不触发（动能保护②-a）', () => {
    // R1 = 10.0%、R2 = 0.909%、R3 = 0.405%：R3 ≥ 0.15×R2（0.136%）通过 b，
    // 但 R2+R3 = 1.31% < 50%×R1 = 5% → 首日大涨后无修复，不开仓
    const bars = [
      ...flats(30),
      bar(30, 10.8, 11.3, 10.7, 11.0),
      bar(31, 11.0, 11.4, 10.9, 11.11),
      bar(32, 11.1, 11.5, 11.0, 11.155)
    ]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('后两日合计接回首日涨幅过半（R2+R3 > 50%×R1）触发', () => {
    // R1 = 10.0%、R2 = 3.0%、R3 = 2.10%：R2+R3 = 5.10% ≥ 5%，R3 ≥ 0.45% → B@32
    const bars = [
      ...flats(30),
      bar(30, 10.8, 11.3, 10.7, 11.0),
      bar(31, 11.05, 11.6, 10.95, 11.33),
      bar(32, 11.35, 11.7, 11.25, 11.568)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
  })

  it('第 3 日收盘低于 MA30 不触发（均线门槛②）', () => {
    // 30 根阴跌后三日反弹 14.4 → 14.6 → 14.8：比较与涨幅全过，但 MA30 ≈ 16.58 > 14.8
    const slowDecline = Array.from({ length: 30 }, (_, i) => {
      const close = 20 - 0.2 * i
      return bar(i, close - 0.2, close + 0.5, close - 0.5, close)
    })
    const bars = [
      ...slowDecline,
      bar(30, 14.2, 14.9, 14.0, 14.4),
      bar(31, 14.4, 15.1, 14.2, 14.6),
      bar(32, 14.6, 15.3, 14.4, 14.8)
    ]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('起始日过滤：起始日之前的交易日不出点（历史只作上下文）', () => {
    // 起始日 = 第 32 日：保留 B@32；起始日 = 第 33 日：B@32 被过滤且持仓中无新 B → 空
    expect(dailySignals(baseBars(), key(32))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
    expect(dailySignals(baseBars(), key(33))).toEqual([])
  })

  it('起始日前的强涨不开仓：窗口内无可见 B 时不标 S（B 必须先出现）', () => {
    // 强涨全在起始日（第 33 日）之前；第 33 日暴跌破了「若开仓」的止损基准，
    // 但持仓态未被起始日前的 B 建立 → 不出无主 S
    const bars = [...baseBars(), bar(33, 12.5, 12.8, 11.5, 11.0)]
    expect(dailySignals(bars, key(33))).toEqual([])
  })
})

describe('dailySignals（卖出：B 后先触发者离场，一枚 B 对一枚 S）', () => {
  it('S1 止损：B 后收盘跌破 B 点前一交易日最低价 → 该日标 S', () => {
    // B@32 的止损基准 = low[31] = 11.6；第 33 日收盘 11.0 跌破 → S@33
    const bars = [...baseBars(), bar(33, 11.2, 11.5, 10.7, 11.0)]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(32), signal: 'buy' },
      { timestamp: ts(33), signal: 'sell' }
    ])
  })

  it('S1 一枚 B 至多一枚 S：离场后继续走低不再标 S', () => {
    const bars = [...baseBars(), bar(33, 11.2, 11.5, 10.7, 11.0), bar(34, 10.8, 11.2, 10.4, 10.5)]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(32), signal: 'buy' },
      { timestamp: ts(33), signal: 'sell' }
    ])
  })

  it('S1 未触发：B 后收盘未破止损基准则不出 S', () => {
    // 第 33/34 日收盘 13.0/13.2 均高于止损基准 11.6，也非 B（未过前日高/收）
    const bars = [...baseBars(), bar(33, 12.7, 13.5, 12.5, 13.0), bar(34, 13.0, 13.7, 12.8, 13.2)]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
  })

  it('S2 趋势离场：B 后连续两日收盘低于 MA30 → 第二日标 S（未破止损时）', () => {
    // B@32 开在 MA30 上方（13.6 ≥ 10.24）；第 31 日留下深下影（low 9.8）压低止损基准；
    // 第 33/34 日收 10.2/10.0：连续两日低于 MA30（≈10.24）但高于止损 9.8 → S@34 由 S2 产生
    const bars = [
      ...flats(30),
      strong(30, 11.2),
      bar(31, 12.0, 12.9, 9.8, 12.4),
      strong(32, 13.6),
      bar(33, 10.6, 11.0, 9.9, 10.2),
      bar(34, 10.1, 10.5, 9.9, 10.0)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(32), signal: 'buy' },
      { timestamp: ts(34), signal: 'sell' }
    ])
  })

  it('S 后空仓待重新武装：下一枚 B 重新开仓，可再出 S', () => {
    // B@32 → S@33（跌破 11.6）；第 34/35/36 日重新三日强涨 → B@36
    const bars = [...baseBars(), bar(33, 11.2, 11.5, 10.7, 11.0), strong(34, 12.5), strong(35, 13.7), strong(36, 14.9)]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(32), signal: 'buy' },
      { timestamp: ts(33), signal: 'sell' },
      { timestamp: ts(36), signal: 'buy' }
    ])
  })

  it('B 必须先于 S：无 B 时即使连续跌破 MA30 也不标 S', () => {
    // 42 根阴跌：长期收于 MA30 下方（连续两日条件多次成立），但从未出现 B → 不出 S
    const bars = Array.from({ length: 42 }, (_, i) => down(i))
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('因果性：追加未来 bar 不改变既有信号点（无未来函数）', () => {
    const prefix = dailySignals(baseBars(), key(0))
    // strong33 被成对规则抑制（持仓中不再标 B），flat34 跌破止损 → S@34
    const full = dailySignals([...baseBars(), strong(33, 14.8), flat(34)], key(0))
    expect(full.slice(0, prefix.length)).toEqual(prefix)
  })
})

describe('dailySignals（卖出 S3：持仓期放量 ≥ 前日 3 倍记收盘基准，其后首次连续两日低于基准 → 第二日标 S）', () => {
  it('B 后放量基准被连续两日跌破 → 第二日标 S（未破止损、S1/S2 不触发）', () => {
    // B@32（止损 11.6）；第 33 日量 3000（=3×前日）收 13.0 记基准；第 34/35 日收 12.5/12.4 连续低于 → S@35
    const bars = [
      ...baseBars(),
      volBar(33, 12.7, 13.3, 12.5, 13.0, 3000),
      volBar(34, 12.8, 13.1, 12.3, 12.5),
      volBar(35, 12.5, 12.8, 12.2, 12.4)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(32), signal: 'buy' },
      { timestamp: ts(35), signal: 'sell' }
    ])
  })

  it('两日不连续（中间收复基准）不触发', () => {
    // 第 34 日低于基准、第 35 日收复（13.2 > 13.0）、第 36 日再低于 → 无连续两日
    const bars = [
      ...baseBars(),
      volBar(33, 12.7, 13.3, 12.5, 13.0, 3000),
      volBar(34, 12.8, 13.1, 12.3, 12.5),
      volBar(35, 12.9, 13.4, 12.6, 13.2),
      volBar(36, 13.0, 13.3, 12.4, 12.6)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
  })

  it('放量不足 3 倍（2 倍）不记录基准 → 不触发', () => {
    const bars = [
      ...baseBars(),
      volBar(33, 12.7, 13.3, 12.5, 13.0, 2000),
      volBar(34, 12.8, 13.1, 12.3, 12.5),
      volBar(35, 12.5, 12.8, 12.2, 12.4)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(32), signal: 'buy' }])
  })

  it('B 日自身放量同样记录基准，随后两日跌破 → S', () => {
    // 第 32 日（B 日）量 3000 = 3×前日 → 基准 = B 日收盘 13.6；第 33/34 日收 13.0/12.8 连续低于 → S@34
    const bars = [
      ...flats(30),
      strong(30, 11.2),
      strong(31, 12.4),
      volBar(32, 13.0, 14.1, 12.8, 13.6, 3000),
      volBar(33, 13.2, 13.8, 12.9, 13.0),
      volBar(34, 12.9, 13.3, 12.6, 12.8)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(32), signal: 'buy' },
      { timestamp: ts(34), signal: 'sell' }
    ])
  })

  it('空仓时（无 B）放量破位不标 S（B 必须先出现）', () => {
    const bars = [
      ...flats(30),
      volBar(30, 9.8, 10.6, 9.6, 10.2, 3000),
      volBar(31, 10.0, 10.3, 9.7, 9.8),
      volBar(32, 9.7, 10.0, 9.4, 9.6)
    ]
    expect(dailySignals(bars, key(0))).toEqual([])
  })

  it('空仓期（B 前）放量不记录：B 后两日低于该旧放量收盘也不触发', () => {
    // 第 25 日空仓放量 3000 收 13.0 → 不记录；第 26 日回撤后第 27/28/29 日三日强涨 B@29（止损 11.6）；
    // 第 30/31 日收 12.6/12.5（低于旧放量收盘 13.0 但高于止损）→ 无 S
    const bars = [
      ...flats(25),
      volBar(25, 12.7, 13.3, 12.5, 13.0, 3000),
      bar(26, 11.3, 11.5, 10.7, 11.0),
      strong(27, 11.2),
      strong(28, 12.4),
      strong(29, 13.6),
      volBar(30, 13.2, 13.6, 12.4, 12.6),
      volBar(31, 12.5, 12.8, 12.2, 12.5)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(29), signal: 'buy' }])
  })

  it('S 离场时基准复位：旧放量收盘不带入下一对 B/S', () => {
    // B@32 → 第 33 日放量 3000 收 13.0 记基准 → 第 34 日跌破止损 S@34（基准复位）；
    // 第 35/36/37 日三日强涨 B@37 → 第 38/39 日收 12.6/12.5 低于旧基准 13.0 但不再触发
    const bars = [
      ...baseBars(),
      volBar(33, 12.7, 13.3, 12.5, 13.0, 3000),
      bar(34, 11.2, 11.9, 10.8, 11.0),
      strong(35, 11.5),
      strong(36, 12.7),
      strong(37, 13.9),
      volBar(38, 13.0, 13.4, 12.4, 12.6),
      volBar(39, 12.5, 12.8, 12.2, 12.5)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(32), signal: 'buy' },
      { timestamp: ts(34), signal: 'sell' },
      { timestamp: ts(37), signal: 'buy' }
    ])
  })
})

describe('dailySignals（卖出 S4：持仓期最高价创半年新高记收盘基准，其后首次连续 3 日收盘低于基准 → 第三日标 S）', () => {
  /** 120 根平盘铺垫（close 10 / high 10.5）供半年回看成形 */
  const wideFlats = () => flats(120)

  /** 替换第 replaceIndex 根为指定 bar 的铺垫 */
  const flatsWith = (replaceIndex: number, replaced: KLineData) =>
    flats(120).map((b, i) => (i === replaceIndex ? replaced : b))

  it('B 日自身创半年新高即记基准，随后连续三日低于基准 → 第三日标 S', () => {
    // B@122（high 14.1 > 回看内全部 10.5 → 基准 = B 日收盘 13.6）；第 123/124/125 日收
    // 13.0/12.8/12.6 连续三日低于 13.6（高于止损 11.6、高于 MA30、无放量）→ S@125 由 S4 产生
    const bars = [
      ...wideFlats(),
      strong(120, 11.2),
      strong(121, 12.4),
      strong(122, 13.6),
      bar(123, 13.2, 13.5, 12.9, 13.0),
      bar(124, 13.0, 13.3, 12.7, 12.8),
      bar(125, 12.8, 13.1, 12.5, 12.6)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(122), signal: 'buy' },
      { timestamp: ts(125), signal: 'sell' }
    ])
  })

  it('三日均低于基准但非逐日下跌（第二日收涨）仍触发（口径 = 对基准比较）', () => {
    // 基准 13.6；第 123/124/125 日收 13.0/13.2/12.9：第二日虽收涨但仍低于基准 → 连续三日破位 → S@125
    const bars = [
      ...wideFlats(),
      strong(120, 11.2),
      strong(121, 12.4),
      strong(122, 13.6),
      bar(123, 13.2, 13.5, 12.9, 13.0),
      bar(124, 13.1, 13.4, 12.9, 13.2),
      bar(125, 13.0, 13.3, 12.7, 12.9)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(122), signal: 'buy' },
      { timestamp: ts(125), signal: 'sell' }
    ])
  })

  it('中间一日收复基准（收盘 ≥ 基准）清零计数，不足三日不出 S', () => {
    // 基准 13.6；13.0（1）→ 13.7 收复清零 → 13.0（1）→ 12.8（2）→ 不满三日
    const bars = [
      ...wideFlats(),
      strong(120, 11.2),
      strong(121, 12.4),
      strong(122, 13.6),
      bar(123, 13.2, 13.5, 12.9, 13.0),
      bar(124, 13.5, 13.9, 13.0, 13.7),
      bar(125, 13.2, 13.5, 12.9, 13.0),
      bar(126, 13.0, 13.3, 12.7, 12.8)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(122), signal: 'buy' }])
  })

  it('未创半年新高不记基准 → 三日走低不触发（空仓期旧高点封顶）', () => {
    // 第 5 日留下 high 20 的长上影（空仓期高点）；B@122 的 14.1 在回看内未创新高 → 无基准
    const bars = [
      ...flatsWith(5, bar(5, 19.5, 20, 9.5, 10)),
      strong(120, 11.2),
      strong(121, 12.4),
      strong(122, 13.6),
      bar(123, 13.2, 13.5, 12.9, 13.0),
      bar(124, 13.0, 13.3, 12.7, 12.8),
      bar(125, 12.8, 13.1, 12.5, 12.6)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(122), signal: 'buy' }])
  })

  it('持仓期内后续新高同样重记基准（新基准替换旧基准）', () => {
    // 第 100 日留下 high 15（B 前高点）；B@122 的 14.1 未创新高；
    // 第 123 日 high 15.5 创半年新高 → 基准 = 当日收盘 13.0；第 124/125/126 日收 12.8/12.6/12.4 低于 13.0 → S@126
    const bars = [
      ...flatsWith(100, bar(100, 14.5, 15, 9.5, 10)),
      strong(120, 11.2),
      strong(121, 12.4),
      strong(122, 13.6),
      bar(123, 13.2, 15.5, 12.9, 13.0),
      bar(124, 13.0, 13.3, 12.7, 12.8),
      bar(125, 12.8, 13.1, 12.5, 12.6),
      bar(126, 12.6, 12.9, 12.3, 12.4)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(122), signal: 'buy' },
      { timestamp: ts(126), signal: 'sell' }
    ])
  })
})

describe('dailySignals（卖出 S5：持仓期三连阴第 3 日记最低价基准，其后首次连续两日收盘低于该最低价 → 第二日标 S）', () => {
  /** 120 根平盘铺垫 + 第 5 日 high 20 封顶（B 日不构成半年新高，屏蔽 S4 干扰） */
  const wideFlats = () => flats(120).map((b, i) => (i === 5 ? bar(5, 19.5, 20, 9.5, 10) : b))

  it('三连阴确认记基准，随后连续两日收盘跌破 → 第二日标 S', () => {
    // B@122 → 第 123/124/125 日收 13.2/12.9/12.6 三连阴（第 3 日最低 12.3 记基准）；
    // 第 126/127 日收 12.0/11.9 连续两日低于 12.3（高于止损 11.6、无放量、无新高）→ S@127 由 S5 产生
    const bars = [
      ...wideFlats(),
      strong(120, 11.2),
      strong(121, 12.4),
      strong(122, 13.6),
      bar(123, 13.4, 13.5, 12.9, 13.2),
      bar(124, 13.1, 13.3, 12.6, 12.9),
      bar(125, 12.8, 13.1, 12.3, 12.6),
      bar(126, 12.4, 12.7, 11.8, 12.0),
      bar(127, 12.0, 12.2, 11.5, 11.9)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(122), signal: 'buy' },
      { timestamp: ts(127), signal: 'sell' }
    ])
  })

  it('不足三连阴（中间收涨断链）不记基准 → 无 S', () => {
    // 13.2（1）→ 13.4 收涨清零 → 13.1（1）→ 12.9（2）：两次断链均未满三日
    const bars = [
      ...wideFlats(),
      strong(120, 11.2),
      strong(121, 12.4),
      strong(122, 13.6),
      bar(123, 13.3, 13.5, 12.9, 13.2),
      bar(124, 13.2, 13.6, 12.9, 13.4),
      bar(125, 13.2, 13.4, 12.8, 13.1),
      bar(126, 13.0, 13.2, 12.6, 12.9)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(122), signal: 'buy' }])
  })

  it('两日收破中间被收复断开（单日跌破不成对）不出 S', () => {
    // 三连阴 123-125 记基准 12.3；126 收 12.2 破（1）→ 127 收 12.4 收复断开 → 128 收 12.1 破（1）→ 未成对
    const bars = [
      ...wideFlats(),
      strong(120, 11.2),
      strong(121, 12.4),
      strong(122, 13.6),
      bar(123, 13.3, 13.5, 12.9, 13.2),
      bar(124, 13.1, 13.3, 12.6, 12.9),
      bar(125, 12.8, 13.1, 12.3, 12.6),
      bar(126, 12.4, 12.5, 11.9, 12.2),
      bar(127, 12.3, 12.6, 12.1, 12.4),
      bar(128, 12.2, 12.4, 11.8, 12.1)
    ]
    expect(dailySignals(bars, key(0))).toEqual([{ timestamp: ts(122), signal: 'buy' }])
  })

  it('新一次三连阴重记基准（旧基准被替换，且新基准更低）', () => {
    // 首轮三连阴 123-125 记基准 12.3；126 收涨清零；第二轮 127-129 三连阴重记基准 12.1；
    // 130/131 收 12.0/11.9 连续两日低于 12.1 → S@131
    const bars = [
      ...wideFlats(),
      strong(120, 11.2),
      strong(121, 12.4),
      strong(122, 13.6),
      bar(123, 13.3, 13.5, 12.9, 13.2),
      bar(124, 13.1, 13.3, 12.6, 12.9),
      bar(125, 12.8, 13.1, 12.3, 12.6),
      bar(126, 12.7, 13.2, 12.5, 13.0),
      bar(127, 12.9, 13.0, 12.5, 12.8),
      bar(128, 12.7, 12.9, 12.3, 12.6),
      bar(129, 12.5, 12.7, 12.1, 12.4),
      bar(130, 12.2, 12.4, 11.7, 12.0),
      bar(131, 12.0, 12.1, 11.4, 11.9)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(122), signal: 'buy' },
      { timestamp: ts(131), signal: 'sell' }
    ])
  })
})

describe('dailySignals（卖出 S1/S2 趋势乘骑分支：MA30 在 MA60 上方持续超 15 日时，替换为收盘跌破 MA60 离场）', () => {
  /** 匀速爬升日（close，high/low = close ± 0.3） */
  const ramp = (i: number, close: number) => bar(i, close - 0.1, close + 0.3, close - 0.3, close)

  /** 温和爬升收盘（单日交替回踩：破坏三日强涨链但保持均线上行，k = 0 起的爬升序号） */
  const gentleClose = (k: number) => 10 + 0.05 * k + (k % 2 === 0 ? 0.08 : -0.05)

  /** 成熟多头铺垫：60 根平盘（第 5 日 high 20 封顶屏蔽 S4）+ 70 日温和爬升 */
  const matureUptrend = () => [
    ...flats(60).map((b, i) => (i === 5 ? bar(5, 9.9, 20, 9.5, 10) : b)),
    ...Array.from({ length: 70 }, (_, k) => ramp(60 + k, gentleClose(k)))
  ]

  it('成熟多头段：跌破 B 前一日最低 / 跌破 MA30 均被抑制，收盘跌破 MA60 才离场', () => {
    // 爬升 70 日 → MA30 自第 60 日起持续高于 MA60（streak ≈ 74 > 15）→ 趋势乘骑
    // B@132（止损 13.1）：第 133 日收 13.0 已破止损但收于 MA60 ≈ 12.1 之上 → 持有（原 S1 被替换）
    // 第 134 日收 12.8 仍高于 MA60 → 持有；第 135 日收 11.9 < MA60 → S@135
    const bars = [
      ...matureUptrend(),
      strong(130, 13.6),
      strong(131, 13.9),
      strong(132, 14.2),
      bar(133, 13.1, 13.4, 12.8, 13.0),
      bar(134, 12.9, 13.2, 12.6, 12.8),
      bar(135, 12.3, 12.6, 11.4, 11.9)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(132), signal: 'buy' },
      { timestamp: ts(135), signal: 'sell' }
    ])
  })

  it('多头段不成熟（MA30 在 MA60 上方 14 日，未超过 15）维持原 S1 止损', () => {
    // 平盘至第 118 日，爬升 11 日（首日平收、末日回踩，断开与强涨日的三日链）→
    // streak@133 = 14 ≤ 15 → 原判定：B@132（止损 10.8），第 133 日收 10.7 破止损 → S@133
    const bars = [
      ...flats(119),
      ...Array.from({ length: 11 }, (_, k) => ramp(119 + k, gentleClose(k + 1))),
      strong(130, 11.3),
      strong(131, 11.6),
      strong(132, 11.9),
      bar(133, 11.0, 11.3, 10.6, 10.7)
    ]
    expect(dailySignals(bars, key(0))).toEqual([
      { timestamp: ts(132), signal: 'buy' },
      { timestamp: ts(133), signal: 'sell' }
    ])
  })
})
