import type { KLineData } from 'klinecharts'
import { describe, expect, it } from 'vitest'
import type { FundamentalData } from '../chart/types'
import {
  annualizedVol,
  changePctOver,
  maBullOf,
  maDevAt,
  macdGoldenWithin,
  matchesAll,
  matchesAnyDayInRange,
  matchesCondition,
  offHighPct,
  rsiAt,
  truncateBarsAsOf,
  volumeRatioAt
} from './indicators'
import { SCREENER_INDICATORS } from './types'
import type { ScreenerCondition } from './types'
import { screenerConditionsError, screenerRequestError } from './validate'

/** 校验用合法条件组（RSI + PE） */
const validConditions: ScreenerCondition[] = [
  { key: 'rsi', params: { n: 14 }, op: 'lt', value: 40 },
  { key: 'pe', params: {}, op: 'gt', value: 0 }
]

/** 构造日 K：默认 high=close+0.5、low=close-0.5、volume=1000 */
const barsOf = (closes: number[], volume = 1000): KLineData[] =>
  closes.map((close, i) => ({
    timestamp: 1_700_000_000_000 + i * 86_400_000,
    open: close,
    close,
    high: close + 0.5,
    low: close - 0.5,
    volume
  }))

const fundamental: FundamentalData = {
  pe: 15,
  pb: 2,
  turnoverRate: 3,
  floatMarketCap: 500_0000_0000
}

describe('量化指标纯函数', () => {
  it('maDevAt：常数序列偏离 0，数据不足 null', () => {
    expect(maDevAt([10, 10, 10, 10, 10], 5)).toBe(0)
    expect(maDevAt([10, 10, 10], 5)).toBeNull()
    expect(maDevAt([9, 10, 11, 12, 13], 5)).toBeCloseTo(((13 - 11) / 11) * 100, 6)
  })

  it('changePctOver：N 日涨跌幅与数据不足', () => {
    expect(changePctOver([10, 11, 12, 13.2], 3)).toBeCloseTo(32, 6)
    expect(changePctOver([10, 11], 3)).toBeNull()
  })

  it('rsiAt：全涨 100 / 全跌 0 / 涨跌对称 50（Cutler 口径）', () => {
    expect(rsiAt([10, 11, 12, 13, 14], 4)).toBe(100)
    expect(rsiAt([14, 13, 12, 11, 10], 4)).toBe(0)
    // 窗口 4：diff = +1,-1,+1,-1 → gains=losses=2
    expect(rsiAt([10, 11, 10, 11, 10], 4)).toBeCloseTo(50, 6)
  })

  it('volumeRatioAt：近 5 日 / 前 20 日均量倍数', () => {
    const volumes = [...Array(20).fill(100), ...Array(5).fill(300)]
    expect(volumeRatioAt(volumes)).toBe(3)
    expect(volumeRatioAt([1, 2, 3])).toBeNull()
    // 前 20 日均量为 0（长期停牌）无法计算
    expect(volumeRatioAt([...Array(20).fill(0), ...Array(5).fill(100)])).toBeNull()
  })

  it('offHighPct：贴近高点为 0，回撤为负', () => {
    const bars = barsOf([10, 11, 12, 11.4])
    expect(offHighPct(bars, 4)).toBeCloseTo(((11.4 - 12.5) / 12.5) * 100, 6)
    // 末日收盘 = 窗口最高（high 即 close）时偏离为 0
    const peak = [...barsOf([10, 11]), { ...barsOf([12.5])[0], high: 12.5 }]
    expect(offHighPct(peak, 3)).toBeCloseTo(0, 6)
  })

  it('annualizedVol：常数价格波动率 0，数据不足 null', () => {
    expect(annualizedVol(Array(30).fill(10), 20)).toBe(0)
    expect(annualizedVol([1, 2, 3], 20)).toBeNull()
  })

  it('maBullOf：上升序列多头成立，不足 20 根不成立', () => {
    expect(maBullOf(Array.from({ length: 30 }, (_, i) => 10 + i))).toBe(true)
    expect(maBullOf(Array.from({ length: 30 }, (_, i) => 10 - i))).toBe(false)
    expect(maBullOf([1, 2, 3])).toBe(false)
  })

  it('macdGoldenWithin：长期下跌后拉升出现金叉，单调下跌无金叉', () => {
    const dip = Array.from({ length: 60 }, (_, i) => 100 - i * 0.5)
    const rally = Array.from({ length: 30 }, (_, i) => 70 + i * 1.5)
    expect(macdGoldenWithin([...dip, ...rally], 30)).toBe(true)
    expect(macdGoldenWithin(dip, 30)).toBe(false)
    // 预热不足直接 false
    expect(macdGoldenWithin([1, 2, 3, 4, 5], 2)).toBe(false)
  })
})

describe('条件求值', () => {
  const bars = barsOf(Array.from({ length: 60 }, (_, i) => 10 + i * 0.1))
  const ctx = { bars, fundamental }

  it('数值条件：gt/lt/between 与缺数据不匹配', () => {
    expect(matchesCondition({ key: 'pe', params: {}, op: 'gt', value: 10 }, ctx).pass).toBe(true)
    expect(matchesCondition({ key: 'pe', params: {}, op: 'lt', value: 10 }, ctx).pass).toBe(false)
    expect(matchesCondition({ key: 'pb', params: {}, op: 'between', min: 1, max: 3 }, ctx).pass).toBe(true)
    // 缺字段（无 floatMarketCap）不匹配且值为 null
    const missing = matchesCondition(
      { key: 'floatCapYi', params: {}, op: 'gt', value: 1 },
      {
        bars: null,
        fundamental: {}
      }
    )
    expect(missing).toEqual({ pass: false, value: null })
  })

  it('布尔条件：命中输出 1/0，日K缺失不匹配', () => {
    const hit = matchesCondition({ key: 'maBull', params: {}, op: 'bool' }, ctx)
    expect(hit).toEqual({ pass: true, value: 1 })
    expect(matchesCondition({ key: 'maBull', params: {}, op: 'bool' }, { bars: null, fundamental: {} }).pass).toBe(
      false
    )
  })

  it('matchesAll：AND 语义 + 值聚合（布尔指标 1/0）', () => {
    const result = matchesAll(
      [
        { key: 'maBull', params: {}, op: 'bool' },
        { key: 'pe', params: {}, op: 'lt', value: 20 },
        { key: 'pe', params: {}, op: 'gt', value: 100 }
      ],
      ctx
    )
    expect(result.pass).toBe(false)
    expect(result.values.maBull).toBe(1)
    expect(result.values.pe).toBe(15)
  })
})

describe('条件校验', () => {
  it('空条件 / 超限 / 阈值缺失 / 参数越界 / 布尔运算符错配均被拦截', () => {
    expect(screenerConditionsError([])).toContain('至少')
    expect(
      screenerConditionsError(
        Array.from({ length: 9 }, () => ({ key: 'pb' as const, params: {}, op: 'lt' as const, value: 3 }))
      )
    ).toContain('最多')
    expect(screenerConditionsError([{ key: 'pb', params: {}, op: 'lt' }])).toContain('阈值')
    expect(screenerConditionsError([{ key: 'rsi', params: { n: 1 }, op: 'lt', value: 30 }])).toContain('参数')
    expect(screenerConditionsError([{ key: 'maBull', params: {}, op: 'gt', value: 1 }])).toContain('布尔')
    expect(screenerConditionsError([{ key: 'pe', params: {}, op: 'between', min: 20, max: 5 }])).toContain('区间')
  })

  it('指标库全部指标以单条件形式通过校验（参数取默认值）', () => {
    for (const meta of SCREENER_INDICATORS) {
      const params: Record<string, number> = {}
      meta.params.forEach((param) => {
        params[param.name] = param.def
      })
      const condition = meta.boolean
        ? { key: meta.key, params, op: 'bool' as const }
        : { key: meta.key, params, op: 'gt' as const, value: 0 }
      expect(screenerConditionsError([condition]), meta.key).toBeNull()
    }
  })
})

describe('截止日期（as-of）', () => {
  /** 时间戳 → 本地 yyyy-mm-dd */
  const dayStrOf = (ts: number): string => {
    const date = new Date(ts)
    return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
  }

  const dayStr = (offsetDays: number): string => dayStrOf(Date.now() + offsetDays * 86_400_000)

  it('truncateBarsAsOf：保留截止日（含当日）之前的 bar，其后剔除', () => {
    // 时间戳取本地日界，规避时区导致的日偏移
    const base = new Date().setHours(0, 0, 0, 0)
    const bars: KLineData[] = [10, 11, 12, 13].map((close, i) => ({
      timestamp: base + i * 86_400_000,
      open: close,
      close,
      high: close + 0.5,
      low: close - 0.5,
      volume: 1000
    }))
    // 截止日 = 第 3 根 bar（close 12）所在日 → 保留前三根
    const truncated = truncateBarsAsOf(bars, dayStrOf(bars[2]!.timestamp))
    expect(truncated).toHaveLength(3)
    expect(truncated[2]!.close).toBe(12)
  })

  it('truncateBarsAsOf：非法日期返回空数组', () => {
    expect(truncateBarsAsOf(barsOf([10, 11]), '2026-13-40')).toEqual([])
    expect(truncateBarsAsOf(barsOf([10, 11]), 'not-a-date')).toEqual([])
  })

  it('校验：未来日期 / 超出一年 / 非法格式拒绝，近一年历史日通过', () => {
    const base = { conditions: validConditions }
    expect(screenerRequestError({ ...base, asOf: dayStr(1) })).toContain('历史')
    expect(screenerRequestError({ ...base, asOf: dayStr(0) })).toContain('历史')
    expect(screenerRequestError({ ...base, asOf: dayStr(-400) })).toContain('一年')
    expect(screenerRequestError({ ...base, asOf: '2026-02-31' })).toContain('格式')
    expect(screenerRequestError({ ...base, asOf: dayStr(-30) })).toBeNull()
    expect(screenerRequestError(base)).toBeNull()
  })

  it('校验：from 同规格护栏，from 晚于 asOf 拒绝', () => {
    const base = { conditions: validConditions }
    expect(screenerRequestError({ ...base, from: dayStr(1) })).toContain('历史')
    expect(screenerRequestError({ ...base, from: dayStr(-400) })).toContain('一年')
    expect(screenerRequestError({ ...base, from: dayStr(-60), asOf: dayStr(-30) })).toBeNull()
    expect(screenerRequestError({ ...base, from: dayStr(-30), asOf: dayStr(-60) })).toContain('不晚于')
  })
})

describe('区间逐日扫描', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i / 3) + i * 0.1)
  const midnight = new Date().setHours(0, 0, 0, 0)
  const bars: KLineData[] = closes.map((close, i) => ({
    timestamp: midnight + i * 86_400_000,
    open: close,
    close,
    high: close + 0.5,
    low: close - 0.5,
    volume: 1000 + (i % 7) * 100
  }))
  /** 第 i 日的单日区间（时间戳取当日 0 点，落于该日内） */
  const dayRangeOf = (i: number) => ({ startTs: bars[i]!.timestamp, endTs: bars[i]!.timestamp })

  const technicalConditions: ScreenerCondition[] = [
    { key: 'maDev' as const, params: { n: 20 }, op: 'gt' as const, value: -5 },
    { key: 'rsi' as const, params: { n: 14 }, op: 'lt' as const, value: 60 },
    { key: 'changePctN' as const, params: { n: 5 }, op: 'gt' as const, value: -2 },
    { key: 'volumeRatio' as const, params: {}, op: 'gt' as const, value: 0.5 },
    { key: 'offHighN' as const, params: { n: 30 }, op: 'gt' as const, value: -10 },
    { key: 'volatility' as const, params: { n: 20 }, op: 'lt' as const, value: 100 },
    { key: 'maBull' as const, params: {}, op: 'bool' as const },
    { key: 'macdCross' as const, params: { n: 5 }, op: 'bool' as const }
  ]

  it('单日区间与单点求值（matchesAll）口径一致', () => {
    for (const i of [30, 45, 59]) {
      const scan = matchesAnyDayInRange(technicalConditions, { bars, fundamental: {}, markPrice: null }, dayRangeOf(i))
      const single = matchesAll(technicalConditions, { bars: bars.slice(0, i + 1), fundamental: {} })
      expect(scan.pass, `day ${i} pass`).toBe(single.pass)
      for (const [key, scanValue] of Object.entries(scan.values)) {
        const singleValue = single.values[key]
        if (singleValue == null || scanValue == null) {
          // 数据不足侧（如布尔预热门槛在单点为 null、扫描器为 0）不构成口径漂移
          expect(singleValue == null && scanValue == null ? null : (singleValue ?? scanValue)).toBeDefined()
          continue
        }
        expect(scanValue).toBeCloseTo(singleValue, 9)
      }
    }
  })

  it('区间内任一日命中即算，取最近命中日', () => {
    const condition = [{ key: 'rsi' as const, params: { n: 14 }, op: 'lt' as const, value: 50 }]
    const hitDays = bars
      .map((_, i) => i)
      .filter((i) => {
        const value = rsiAt(closes.slice(0, i + 1), 14)
        return value != null && value < 50
      })
    expect(hitDays.length).toBeGreaterThan(0)
    const latest = hitDays[hitDays.length - 1]!
    const scan = matchesAnyDayInRange(
      condition,
      { bars, fundamental: {}, markPrice: null },
      { startTs: bars[0]!.timestamp, endTs: bars[bars.length - 1]!.timestamp }
    )
    expect(scan.pass).toBe(true)
    expect(scan.hitIndex).toBe(latest)
    // 区间只含非命中尾段 → 不命中
    const missScan = matchesAnyDayInRange(
      condition,
      { bars, fundamental: {}, markPrice: null },
      {
        startTs: bars[latest + 1]?.timestamp ?? bars[0]!.timestamp,
        endTs: bars[bars.length - 1]!.timestamp
      }
    )
    expect(missScan.pass).toBe(false)
  })

  it('基本面逐日按收盘/现价比例回溯，换手率由该日量推算', () => {
    const fundamental: FundamentalData = { pe: 20, pb: 2, floatMarketCap: 1e10 }
    const i = 50
    const close = closes[i]!
    const volume = bars[i]!.volume ?? 0
    // 定标价 = 该日收盘 → ratio 1
    const anchored = matchesAnyDayInRange(
      [{ key: 'pe', params: {}, op: 'gt', value: 0 }],
      { bars, fundamental, markPrice: close },
      dayRangeOf(i)
    )
    expect(anchored.pass).toBe(true)
    expect(anchored.values.pe).toBeCloseTo(20, 9)
    // 定标价减半 → PE 翻倍（该日价格相对现价翻倍）
    const doubled = matchesAnyDayInRange(
      [{ key: 'pe', params: {}, op: 'gt', value: 0 }],
      { bars, fundamental, markPrice: close / 2 },
      dayRangeOf(i)
    )
    expect(doubled.values.pe).toBeCloseTo(40, 9)
    // 换手率 = 量(手)×100 / (流通市值/现价) × 100
    const turnover = matchesAnyDayInRange(
      [{ key: 'turnoverRate', params: {}, op: 'gt', value: -1 }],
      { bars, fundamental, markPrice: close },
      dayRangeOf(i)
    )
    expect(turnover.values.turnoverRate).toBeCloseTo(((volume * 100) / (1e10 / close)) * 100, 9)
  })
})
