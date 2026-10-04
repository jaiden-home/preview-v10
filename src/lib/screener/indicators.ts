import type { KLineData } from 'klinecharts'
import type { FundamentalData } from '../chart/types'
import type { ScreenerCondition, ScreenerIndicatorKey } from './types'

// ==================== 量化指标计算（纯函数，环境无关） ====================
// 口径说明（登记于 UI_SPEC §3.16）：
// - RSI 采用 Cutler 简单均值法（涨/跌幅的 SMA 比率），非 Wilder 递推
// - MACD = EMA12 - EMA26，DEA = DIF 的 EMA9；金叉 = DIF 自下而上穿越 DEA
// - 年化波动率 = N 日简单收益率标准差 × √250 × 100
// - 量能倍数 = 近 5 日均量 / 之前 20 日均量
// 数据不足一律返回 null（条件求值视为不匹配，保守过滤）。

const smaAt = (values: number[], n: number): number | null => {
  if (values.length < n || n <= 0) {
    return null
  }
  let sum = 0
  for (let i = values.length - n; i < values.length; i++) {
    sum += values[i]
  }
  return sum / n
}

/** EMA 全序列（首值取首样本，之后按周期标准递推） */
const emaSeriesWithPeriod = (values: number[], period: number): number[] => {
  if (values.length === 0) {
    return []
  }
  const k = 2 / (period + 1)
  const series: number[] = [values[0]]
  for (let i = 1; i < values.length; i++) {
    series.push(values[i] * k + series[i - 1] * (1 - k))
  }
  return series
}

/** 现价距 MA(n) 偏离度 % */
export const maDevAt = (closes: number[], n: number): number | null => {
  const ma = smaAt(closes, n)
  const close = closes.at(-1)
  if (ma == null || ma <= 0 || close == null) {
    return null
  }
  return ((close - ma) / ma) * 100
}

/** N 日涨跌幅 % */
export const changePctOver = (closes: number[], n: number): number | null => {
  if (closes.length <= n || n <= 0) {
    return null
  }
  const base = closes[closes.length - 1 - n]
  const close = closes.at(-1)
  if (base == null || base <= 0 || close == null) {
    return null
  }
  return ((close - base) / base) * 100
}

/** RSI(n)（Cutler SMA 口径） */
export const rsiAt = (closes: number[], n: number): number | null => {
  if (closes.length <= n || n <= 0) {
    return null
  }
  let gains = 0
  let losses = 0
  for (let i = closes.length - n; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) {
      gains += diff
    } else {
      losses -= diff
    }
  }
  const avgGain = gains / n
  const avgLoss = losses / n
  if (avgLoss === 0) {
    return avgGain === 0 ? null : 100
  }
  return 100 - 100 / (1 + avgGain / avgLoss)
}

/** 量能倍数：近 5 日均量 / 之前 20 日均量 */
export const volumeRatioAt = (volumes: number[]): number | null => {
  if (volumes.length < 25) {
    return null
  }
  const recent = volumes.slice(-5)
  const prior = volumes.slice(-25, -5)
  const avg = (list: number[]): number | null => {
    if (list.length === 0 || list.some((v) => v < 0)) {
      return null
    }
    return list.reduce((sum, v) => sum + v, 0) / list.length
  }
  const priorAvg = avg(prior)
  const recentAvg = avg(recent)
  if (priorAvg == null || recentAvg == null || priorAvg <= 0) {
    return null
  }
  return recentAvg / priorAvg
}

/** 距 N 日最高价的回撤 %（≤0，越接近 0 越贴近高点） */
export const offHighPct = (bars: KLineData[], n: number): number | null => {
  if (bars.length < Math.min(n, 2) || n <= 0) {
    return null
  }
  const window = bars.slice(-n)
  const high = Math.max(...window.map((bar) => bar.high))
  const close = bars.at(-1)?.close
  if (!(high > 0) || close == null) {
    return null
  }
  return ((close - high) / high) * 100
}

/** N 日年化波动率 % */
export const annualizedVol = (closes: number[], n: number): number | null => {
  if (closes.length <= n || n <= 1) {
    return null
  }
  const returns: number[] = []
  for (let i = closes.length - n; i < closes.length; i++) {
    const base = closes[i - 1]
    if (base <= 0) {
      return null
    }
    returns.push(closes[i] / base - 1)
  }
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
  return Math.sqrt(variance) * Math.sqrt(250) * 100
}

/** 均线多头：MA5 > MA10 > MA20 */
export const maBullOf = (closes: number[]): boolean => {
  const ma5 = smaAt(closes, 5)
  const ma10 = smaAt(closes, 10)
  const ma20 = smaAt(closes, 20)
  return ma5 != null && ma10 != null && ma20 != null && ma5 > ma10 && ma10 > ma20
}

/** 近 N 日内 MACD 金叉（DIF 上穿 DEA；序列需预热，建议 ≥ 60 根） */
export const macdGoldenWithin = (closes: number[], n: number): boolean => {
  if (closes.length < 35 + n || n <= 0) {
    return false
  }
  const fast = emaSeriesWithPeriod(closes, 12)
  const slow = emaSeriesWithPeriod(closes, 26)
  const dif = fast.map((v, i) => v - (slow[i] ?? v))
  const dea = emaSeriesWithPeriod(dif, 9)
  for (let i = closes.length - n; i < closes.length; i++) {
    const prevDif = dif[i - 1]
    const prevDea = dea[i - 1]
    if (i > 0 && prevDif != null && prevDea != null && dif[i] > dea[i] && prevDif <= prevDea) {
      return true
    }
  }
  return false
}

/** 指标求值上下文 */
export interface IndicatorContext {
  bars: KLineData[] | null
  fundamental: FundamentalData
}

/** as-of 截止日的本地日界（含当日全天），格式非法返回 null */
export const endOfDayTs = (asOf: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return null
  }
  const ts = Date.parse(`${asOf}T23:59:59.999`)
  return Number.isFinite(ts) ? ts : null
}

/**
 * 日 K 截断到截止日（含当日）：as-of 筛选的指标输入口径。
 * 非法日期或截断后为空返回空数组（调用方以缺数据保守过滤）。
 */
export const truncateBarsAsOf = (bars: KLineData[], asOf: string): KLineData[] => {
  const endTs = endOfDayTs(asOf)
  if (endTs == null) {
    return []
  }
  return bars.filter((bar) => bar.timestamp <= endTs)
}

/** 数值与阈值的运算符比较（gt/lt/between；单点求值与逐日扫描共用） */
const compareNumeric = (condition: ScreenerCondition, value: number): boolean => {
  switch (condition.op) {
    case 'gt':
      return condition.value != null && value > condition.value
    case 'lt':
      return condition.value != null && value < condition.value
    case 'between':
      return condition.min != null && condition.max != null && value >= condition.min && value <= condition.max
    default:
      return false
  }
}

// ==================== 区间逐日扫描（起始~截止任一交易日命中即算，取最近命中日） ====================
// 性能口径：前缀和 / EMA 全序列一次预计算，逐日判定 O(1)~O(n)；
// 数值口径与单点函数（matchesCondition）对齐，由测试保证两套实现不漂移。

/** 区间扫描上下文：markPrice 为现时快照价（基本面逐日比例回溯的定标基准） */
export interface RangeScanContext {
  bars: KLineData[] | null
  fundamental: FundamentalData
  markPrice: number | null
}

/** 扫描区间（时间戳，含两端当日全天） */
export interface DayRange {
  startTs: number
  endTs: number
}

export interface RangeScanResult {
  pass: boolean
  /** 最近命中日在 bars 内的下标（未命中 -1） */
  hitIndex: number
  values: Record<string, number | null>
}

/**
 * 区间内逐日求值全部条件（AND），任一日全部满足即命中——从截止端倒序扫描，
 * 返回最近命中日及其指标值。基本面按「该日收盘 / markPrice」比例逐日回溯
 * （与 replayFundamentalOf 同口径；换手率由该日量 × 100 股 / 流通股本推算）。
 */
export const matchesAnyDayInRange = (
  conditions: ScreenerCondition[],
  ctx: RangeScanContext,
  range: DayRange
): RangeScanResult => {
  const bars = ctx.bars
  if (bars == null || bars.length === 0) {
    return { pass: false, hitIndex: -1, values: {} }
  }

  // ---- 序列预计算（仅依赖 ≤i 的数据，逐日口径安全） ----
  const closes = bars.map((bar) => bar.close)
  const highs = bars.map((bar) => bar.high)
  const vols = bars.map((bar) => bar.volume ?? 0)
  const prefix = [0]
  const prefixVol = [0]
  for (let i = 0; i < bars.length; i++) {
    prefix.push(prefix[i]! + closes[i]!)
    prefixVol.push(prefixVol[i]! + vols[i]!)
  }
  // 涨跌增益/损失前缀和（RSI）
  const prefixGain = [0]
  const prefixLoss = [0]
  for (let i = 1; i < bars.length; i++) {
    const diff = closes[i]! - closes[i - 1]!
    prefixGain.push(prefixGain[i - 1]! + (diff > 0 ? diff : 0))
    prefixLoss.push(prefixLoss[i - 1]! + (diff < 0 ? -diff : 0))
  }
  prefixGain.unshift(0) // 对齐下标：prefixGain[i+1] = 前 i+1 个 gain 之和
  prefixLoss.unshift(0)
  // 日收益前缀和与平方和（波动率）
  const prefixRet = [0, 0]
  const prefixRet2 = [0, 0]
  for (let i = 1; i < bars.length; i++) {
    const base = closes[i - 1]!
    const ret = base > 0 ? closes[i]! / base - 1 : 0
    prefixRet.push(prefixRet[i]! + ret)
    prefixRet2.push(prefixRet2[i]! + ret * ret)
  }
  // MACD 全序列（EMA 前向递推，j 位值仅依赖 ≤j 的收盘）
  const ema = (period: number): number[] => {
    const k = 2 / (period + 1)
    const series = [closes[0]!]
    for (let i = 1; i < closes.length; i++) {
      series.push(closes[i]! * k + series[i - 1]! * (1 - k))
    }
    return series
  }
  const fast = ema(12)
  const slow = ema(26)
  const dif = fast.map((v, i) => v - (slow[i] ?? v))
  const kDea = 2 / 10
  const dea = [dif[0]!]
  for (let i = 1; i < dif.length; i++) {
    dea.push(dif[i]! * kDea + dea[i - 1]! * (1 - kDea))
  }

  const maAt = (i: number, n: number): number | null =>
    n > 0 && i + 1 >= n ? (prefix[i + 1]! - prefix[i + 1 - n]!) / n : null

  /** 某日某条件的指标值（数值型），缺数据 null */
  const numericAt = (condition: ScreenerCondition, i: number): number | null => {
    const n = condition.params.n ?? 0
    switch (condition.key) {
      case 'maDev': {
        const ma = maAt(i, n)
        return ma != null && ma > 0 ? ((closes[i]! - ma) / ma) * 100 : null
      }
      case 'changePctN': {
        if (n <= 0 || i < n) {
          return null
        }
        const base = closes[i - n]!
        return base > 0 ? ((closes[i]! - base) / base) * 100 : null
      }
      case 'rsi': {
        if (n <= 0 || i < n) {
          return null
        }
        const gains = prefixGain[i + 1]! - prefixGain[i - n + 1]!
        const losses = prefixLoss[i + 1]! - prefixLoss[i - n + 1]!
        if (losses === 0) {
          return gains === 0 ? null : 100
        }
        return 100 - 100 / (1 + gains / n / (losses / n))
      }
      case 'volumeRatio': {
        if (i < 24) {
          return null
        }
        const priorAvg = (prefixVol[i - 4]! - prefixVol[i - 24]!) / 20
        const recentAvg = (prefixVol[i + 1]! - prefixVol[i - 4]!) / 5
        return priorAvg > 0 ? recentAvg / priorAvg : null
      }
      case 'offHighN': {
        // 与单点 offHighPct 对齐：前缀不足 n 根时用全部已有根（≥2 根即算）
        if (n <= 0 || i < 1) {
          return null
        }
        let high = highs[Math.max(0, i - n + 1)]!
        for (let j = Math.max(0, i - n + 1) + 1; j <= i; j++) {
          if (highs[j]! > high) {
            high = highs[j]!
          }
        }
        return high > 0 ? ((closes[i]! - high) / high) * 100 : null
      }
      case 'volatility': {
        if (n <= 1 || i < n) {
          return null
        }
        const sumR = prefixRet[i + 1]! - prefixRet[i - n + 1]!
        const sumR2 = prefixRet2[i + 1]! - prefixRet2[i - n + 1]!
        const variance = sumR2 / n - (sumR / n) ** 2
        return Math.sqrt(Math.max(0, variance)) * Math.sqrt(250) * 100
      }
      case 'pe':
      case 'pb':
      case 'floatCapYi':
      case 'turnoverRate': {
        const fund = ctx.fundamental
        const markPrice = ctx.markPrice
        if (markPrice == null || markPrice <= 0 || closes[i] == null) {
          return null
        }
        if (condition.key === 'turnoverRate') {
          const floatCap = fund.floatMarketCap
          if (floatCap == null || floatCap <= 0 || vols[i] == null) {
            return null
          }
          // 主板量为手（×100 股）；流通股本 = 流通市值 / 现价
          return ((vols[i]! * 100) / (floatCap / markPrice)) * 100
        }
        const ratio = closes[i]! / markPrice
        if (condition.key === 'pe') {
          return fund.pe != null ? fund.pe * ratio : null
        }
        if (condition.key === 'pb') {
          return fund.pb != null ? fund.pb * ratio : null
        }
        return fund.floatMarketCap != null ? (fund.floatMarketCap * ratio) / 1e8 : null
      }
      default:
        return null
    }
  }

  /** 某日布尔条件（maBull / macdCross），缺数据 false（保守） */
  const boolAt = (condition: ScreenerCondition, i: number): boolean => {
    if (condition.key === 'maBull') {
      const ma5 = maAt(i, 5)
      const ma10 = maAt(i, 10)
      const ma20 = maAt(i, 20)
      return ma5 != null && ma10 != null && ma20 != null && ma5 > ma10 && ma10 > ma20
    }
    if (condition.key === 'macdCross') {
      const n = condition.params.n ?? 0
      // 与单点函数同预热门槛：前缀长度不足 35+n 视为数据不足（保守不命中）
      if (n <= 0 || i + 1 < 35 + n) {
        return false
      }
      for (let k = i - n + 1; k <= i; k++) {
        if (k > 0 && dif[k]! > dea[k]! && dif[k - 1]! <= dea[k - 1]!) {
          return true
        }
      }
      return false
    }
    return false
  }

  // ---- 倒序逐日扫描（最近命中优先） ----
  for (let i = bars.length - 1; i >= 0; i--) {
    const ts = bars[i]!.timestamp
    if (ts > range.endTs) {
      continue
    }
    if (ts < range.startTs) {
      break
    }
    const values: Record<string, number | null> = {}
    let allPass = true
    for (const condition of conditions) {
      if (condition.key === 'maBull' || condition.key === 'macdCross') {
        values[condition.key] = boolAt(condition, i) ? 1 : 0
        if (!boolAt(condition, i)) {
          allPass = false
          break
        }
      } else {
        const value = numericAt(condition, i)
        values[condition.key] = value
        if (value == null || !compareNumeric(condition, value)) {
          allPass = false
          break
        }
      }
    }
    if (allPass) {
      return { pass: true, hitIndex: i, values }
    }
  }
  return { pass: false, hitIndex: -1, values: {} }
}

/** 数值型指标求值（布尔指标与缺数据返回 null） */
export const numericValueOf = (
  key: ScreenerIndicatorKey,
  params: Record<string, number>,
  ctx: IndicatorContext
): number | null => {
  const bars = ctx.bars
  switch (key) {
    case 'maDev':
      return bars == null
        ? null
        : maDevAt(
            bars.map((b) => b.close),
            params.n
          )
    case 'changePctN':
      return bars == null
        ? null
        : changePctOver(
            bars.map((b) => b.close),
            params.n
          )
    case 'rsi':
      return bars == null
        ? null
        : rsiAt(
            bars.map((b) => b.close),
            params.n
          )
    case 'volumeRatio':
      // volume 可选（klinecharts 类型）：缺失按 0 计（停牌/缺量）
      return bars == null ? null : volumeRatioAt(bars.map((b) => b.volume ?? 0))
    case 'offHighN':
      return bars == null ? null : offHighPct(bars, params.n)
    case 'volatility':
      return bars == null
        ? null
        : annualizedVol(
            bars.map((b) => b.close),
            params.n
          )
    case 'pe':
      return ctx.fundamental.pe ?? null
    case 'pb':
      return ctx.fundamental.pb ?? null
    case 'floatCapYi':
      return ctx.fundamental.floatMarketCap != null ? ctx.fundamental.floatMarketCap / 1e8 : null
    case 'turnoverRate':
      return ctx.fundamental.turnoverRate ?? null
    default:
      return null
  }
}

/** 布尔型指标求值（数值指标返回 null） */
export const boolValueOf = (
  key: ScreenerIndicatorKey,
  params: Record<string, number>,
  ctx: IndicatorContext
): boolean | null => {
  const closes = ctx.bars?.map((b) => b.close) ?? null
  switch (key) {
    case 'maBull':
      return closes == null ? null : maBullOf(closes)
    case 'macdCross':
      return closes == null ? null : macdGoldenWithin(closes, params.n)
    default:
      return null
  }
}

export interface ConditionEvaluation {
  /** 条件是否命中（数据不足视为不匹配） */
  pass: boolean
  /** 指标值（布尔型指标为 1/0；数据不足 null） */
  value: number | null
}

/** 单条条件求值 */
export const matchesCondition = (condition: ScreenerCondition, ctx: IndicatorContext): ConditionEvaluation => {
  const metaBoolean = condition.key === 'maBull' || condition.key === 'macdCross'
  if (metaBoolean) {
    const result = boolValueOf(condition.key, condition.params, ctx)
    return { pass: result === true, value: result == null ? null : result ? 1 : 0 }
  }
  const value = numericValueOf(condition.key, condition.params, ctx)
  if (value == null) {
    return { pass: false, value: null }
  }
  switch (condition.op) {
    case 'gt':
      return { pass: condition.value != null && value > condition.value, value }
    case 'lt':
      return { pass: condition.value != null && value < condition.value, value }
    case 'between':
      return {
        pass: condition.min != null && condition.max != null && value >= condition.min && value <= condition.max,
        value
      }
    default:
      return { pass: false, value }
  }
}

/** 全部条件 AND 求值，返回是否命中与各条件指标值（key 可重复时后者覆盖前者，展示取末值） */
export const matchesAll = (
  conditions: ScreenerCondition[],
  ctx: IndicatorContext
): { pass: boolean; values: Record<string, number | null> } => {
  const values: Record<string, number | null> = {}
  let pass = true
  for (const condition of conditions) {
    const result = matchesCondition(condition, ctx)
    values[condition.key] = result.value
    if (!result.pass) {
      pass = false
    }
  }
  return { pass, values }
}
