import { beforeEach, describe, expect, it } from 'vitest'
import type { AxisRange, KLineData } from 'klinecharts'
import { calcTimeShareAvg, symmetricRangeAround, timeShareState } from './timeshare'

const minute = 60 * 1000

describe('分时图纯函数', () => {
  beforeEach(() => {
    timeShareState.active = false
    timeShareState.prevClose = Number.NaN
    timeShareState.dayKey = null
    timeShareState.lotSize = 100
    timeShareState.isIndex = false
  })

  it('calcTimeShareAvg 优先使用官方成交额（手转股）计算均价', () => {
    const dataList: KLineData[] = [
      { timestamp: minute * 0, open: 10, close: 10, high: 10, low: 10, volume: 100, turnover: 100000 },
      { timestamp: minute * 1, open: 11, close: 12, high: 12, low: 11, volume: 300, turnover: 355000 },
      { timestamp: minute * 2, open: 11.5, close: 11, high: 12, low: 11, volume: 0, turnover: 0 }
    ]
    expect(calcTimeShareAvg(dataList)).toEqual([
      { avg: 100000 / (100 * 100) },
      { avg: 455000 / (400 * 100) },
      { avg: 455000 / (400 * 100) }
    ])
  })

  it('calcTimeShareAvg 科创板按每手 200 股换算均价', () => {
    timeShareState.lotSize = 200
    const dataList: KLineData[] = [
      { timestamp: minute * 0, open: 116, close: 116.8, high: 116.8, low: 116.8, volume: 1454, turnover: 33956797 },
      { timestamp: minute * 1, open: 116.8, close: 115.7, high: 116.8, low: 115.7, volume: 2560, turnover: 59455759 }
    ]
    const result = calcTimeShareAvg(dataList)
    expect(result[0].avg).toBeCloseTo(33956797 / (1454 * 200), 6)
    expect(result[1].avg).toBeCloseTo((33956797 + 59455759) / ((1454 + 2560) * 200), 6)
  })

  it('calcTimeShareAvg 缺少成交额时退回 close*volume 近似', () => {
    const dataList: KLineData[] = [
      { timestamp: minute * 0, open: 10, close: 10, high: 10, low: 10, volume: 10 },
      { timestamp: minute * 1, open: 11, close: 12, high: 12, low: 11, volume: 30 },
      { timestamp: minute * 2, open: 11.5, close: 11, high: 12, low: 11, volume: 0 }
    ]
    expect(calcTimeShareAvg(dataList)).toEqual([
      { avg: 10 },
      { avg: (10 * 10 + 12 * 30) / 40 },
      { avg: (10 * 10 + 12 * 30) / 40 }
    ])
  })

  it('calcTimeShareAvg 指数改用按量加权的点位均值，忽略成交额口径', () => {
    timeShareState.isIndex = true
    const dataList: KLineData[] = [
      { timestamp: minute * 0, open: 3860, close: 3861, high: 3861, low: 3861, volume: 100, turnover: 5102370437 },
      { timestamp: minute * 1, open: 3861, close: 3862, high: 3862, low: 3862, volume: 300, turnover: 25376748819 },
      { timestamp: minute * 2, open: 3862, close: 3858, high: 3862, low: 3858, volume: 0 }
    ]
    // 均价贴着点位量级（约 3861.x），而非额/量除以股数的 ~19
    expect(calcTimeShareAvg(dataList)).toEqual([
      { avg: 3861 },
      { avg: (3861 * 100 + 3862 * 300) / 400 },
      { avg: (3861 * 100 + 3862 * 300) / 400 }
    ])
    const avgs = calcTimeShareAvg(dataList).map((d) => d.avg)
    expect(avgs[1]).toBeGreaterThan(3860)
    expect(avgs[1]).toBeLessThan(3863)
  })

  it('symmetricRangeAround 以昨收为中心对称化区间', () => {
    const range = (from: number, to: number): AxisRange => ({
      from,
      to,
      range: to - from,
      realFrom: from,
      realTo: to,
      realRange: to - from,
      displayFrom: from,
      displayTo: to,
      displayRange: to - from
    })
    expect(symmetricRangeAround(100, range(98, 104))).toEqual(range(96, 104))
    // 基准价无效时原样返回
    const original = range(98, 104)
    expect(symmetricRangeAround(Number.NaN, original)).toBe(original)
    // 单边行情：区间覆盖基准价
    expect(symmetricRangeAround(100, range(100.5, 101))).toEqual(range(99, 101))
  })
})
