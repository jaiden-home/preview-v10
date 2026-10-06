import type { KLineData } from 'klinecharts'
import { dayKeyOf } from './account'

/** 买卖点信号方向（与动作色约定一致：买入红 `--up`、卖出品牌蓝 `--tb-active`） */
export type TradeSignal = 'buy' | 'sell'

export interface SignalPoint {
  /** 信号日 bar 时间戳（图表按 timestamp 匹配 K 线柱） */
  timestamp: number
  signal: TradeSignal
}

/** 买入规则窗口长度：连续 3 日 */
const BUY_RUN_DAYS = 3
/** 买动能保护·修复下限：R2 + R3 须不低于 R1 的 50%（R1/R2/R3 = 窗口第 1/2/3 日单日涨幅） */
const BUY_TAIL_REPAIR_MIN = 0.5
/** 买动能保护·衰减下限：R3 须不低于 R2 的 15% */
const BUY_FADE_RATIO = 0.15
/** 卖出 S2 均线周期：30 日收盘均线（亦为买入门槛②「第 3 日收盘 ≥ 均线」的周期） */
const SELL_MA_DAYS = 30
/** 卖出 S3 放量倍数：当日成交量 ≥ 前一交易日的 3 倍 */
const SELL_SPIKE_RATIO = 3
/** 卖出 S4 新高回看根数：120 个交易日 ≈ 半年（A 股年均 242 个交易日） */
const SELL_HIGH_LOOKBACK_BARS = 120
/** 卖出 S4 破位离场天数：连续 3 个交易日收盘低于新高日基准 */
const SELL_DROP_DAYS = 3
/** 卖出 S5 三连阴确认天数：连续 3 个交易日收盘低于上一交易日 */
const SELL_DOWN_RUN_DAYS = 3
/** 卖出趋势乘骑均线：60 日均线（成熟多头段的趋势锚） */
const SELL_TREND_MA_DAYS = 60
/** 卖出趋势乘骑判定：MA30 连续高于 MA60 的天数须超过 15 日 */
const SELL_TREND_STREAK_DAYS = 15

/**
 * 逐日买卖点求值（纯函数，环境无关）：极速模拟页「当日买入点 / 卖出点」提示的规则域。
 *
 * - 输入为截至当前虚拟日的全部可见日 K（起始日前历史窗口 + 已完成模拟日），
 *   逐日**因果**判定（只用当日及之前的数据，无未来函数）；
 * - 仅 startDate（含）之后的模拟日产出信号点，起始日前历史只作计算上下文不出点、
 *   也不开仓（策略自起始日起始，保证可见序列 B 必先于 S；S 恒随 startDate 后的 B）；
 * - 随 dayIndex 推进逐日补点，最后一枚即「当日」提示；某日无信号则该日不标记；
 * - 纯客户端本地展示口径（对单一用户生效），不入服务端账务与成交链路。
 *
 * 买入（B）：**空仓时**（无未配对的 S），当日为「连续 3 日强涨」的第 3 日——
 * 窗口内每日**最高价高于上一交易日的最高价**且**收盘价高于上一交易日的收盘价**
 * （三日比较：高点过高点、收盘过收盘），并须同时满足两项强化条件：
 * ① 第 3 日收盘价 ≥ 30 日均线（MA30 窗口不足不判定）；
 * ② 动能保护：以 R1/R2/R3 记窗口第 1/2/3 日单日涨幅（vs 各自前一交易日收
 *    盘），涨幅真衰减且不能有效修复则不开仓——任一成立即拦：
 *    R1 的 50% > R2 + R3（后两日合计接不回首日涨幅的一半）；
 *    R2 的 15% > R3（第 3 日涨速衰竭至第 2 日的 15% 以下）。
 *
 * 卖出（S）：**B/S 成对交替**——B 后进入持仓态，S 出现前不再标 B（强势延续
 * 只续持、不加仓标记）；持仓期逐日判定，先触发者离场（一枚 B 对一枚 S）——
 * S1 止损 / S2 趋势离场（趋势乘骑分支）：若 MA30 已**连续超过 15 个交易日**
 * 高于 MA60（成熟多头段），二者替换为「收盘价跌破
 * 60 日均线」即离场（骑趋势、防 MA30 震出；MA60 窗口不足不进入该分支）；
 * 否则维持原判定——S1：收盘价低于 B 点前一交易日的最低价；S2：连续两日
 * 收盘价低于 30 日均线（MA30 窗口不足不判定）；
 * S3 放量破位：**持仓期**（B 日及之后，空仓不观察）当日成交量 ≥ 前一交易日
 * 的 3 倍时记录当日收盘价为观察基准（多枚基准以最近一枚为准），此后首次
 * 出现连续两日收盘低于该基准，第二日离场；基准随仓位生命周期走——离场
 * 即复位，下一对 B/S 重新观察（空仓期与起始日前的放量不记录）。
 * S4 高位破位：**持仓期**（B 日及之后，空仓不观察）当日最高价创近 120 个交易
 * 日（约半年）新高时记录当日收盘价为观察基准（多枚新高以最近一枚为准），
 * 此后首次出现连续 3 个交易日收盘均低于该基准，第三日离场；基准随仓位
 * 生命周期走——离场即复位，下一对 B/S 重新观察（空仓期与起始日前的新高
 * 不记录）。
 * S5 连跌破位：**持仓期**出现连续 3 个交易日收盘价低于上一交易日（三连阴）
 * 时记录第 3 日的最低价为观察基准（新一次三连阴重记基准），此后首次出现
 * 连续 2 个交易日收盘低于该最低价，第二日离场；基准随离场即复位（空仓
 * 期与起始日前的连跌不记录）。
 * B 必须先于 S（无 B 不判 S）；B/S 同日冲突时 B 优先（开仓日不判 S）；
 * S 后空仓，待下一枚 B 重新武装。
 */
export const dailySignals = (bars: KLineData[], startDate: string): SignalPoint[] => {
  const points: SignalPoint[] = []
  const ma = smaOf(
    bars.map((b) => b.close),
    SELL_MA_DAYS
  )
  const belowMa = (k: number): boolean => Number.isFinite(ma[k]!) && bars[k]!.close < ma[k]!
  const ma60 = smaOf(
    bars.map((b) => b.close),
    SELL_TREND_MA_DAYS
  )
  /** MA30 连续高于 MA60 的天数（截至 i；相等、下穿或窗口不足即清零） */
  const aboveDays: number[] = []
  for (let i = 0; i < bars.length; i++) {
    const m30 = ma[i]!
    const m60 = ma60[i]!
    aboveDays[i] = Number.isFinite(m30) && Number.isFinite(m60) && m30 > m60 ? (aboveDays[i - 1] ?? 0) + 1 : 0
  }
  /** 趋势乘骑段：MA30 在 MA60 上方持续超过 15 日（成熟多头，不看乖离） */
  const trendRideAt = (i: number): boolean => aboveDays[i]! > SELL_TREND_STREAK_DAYS
  /** 持仓态：最近一枚未配对 B 的前一交易日最低价（S1 止损基准）；null = 空仓，B/S 均不判定 */
  let stopLow: number | null = null
  /** S3 观察基准：本持仓期内最近一枚放量日（量 ≥ 前日 3 倍）的收盘价；null = 尚无基准 */
  let spikeClose: number | null = null
  /** S4 观察基准：本持仓期内最近一次半年新高日的收盘价；null = 尚无基准 */
  let highClose: number | null = null
  /** S4 破位计数：基准之后连续收盘低于基准的天数 */
  let dropDays = 0
  /** S5 连跌计数：本持仓期内连续收盘低于上一交易日的天数（收涨即清零） */
  let downRun = 0
  /** S5 观察基准：本持仓期内最近一次三连阴第 3 日的最低价；null = 尚无基准 */
  let breakLow: number | null = null

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]!
    const prev = bars[i - 1]!
    // S3 观察：放量 ≥ 前日 3 倍（仅持仓期记录，基准属于当前 B/S 对）
    const prevVol = prev.volume ?? 0
    const volumeSpiked = prevVol > 0 && (bar.volume ?? 0) >= prevVol * SELL_SPIKE_RATIO

    if (stopLow == null) {
      // B：空仓 + 连续 3 日（高点过高点、收盘过收盘）第 3 日 + 两项强化条件——
      // ① 第 3 日收盘 ≥ MA30 ② 动能保护：R1 的 50% > R2+R3 或 R2 的 15% > R3 即拦；
      // 起始日起开仓并记止损基准，开仓日不判 S；起始日前的强涨不开仓（策略自起始日起始）
      if (
        i >= BUY_RUN_DAYS &&
        isStrongRun(bars, i) &&
        day3KeepsMomentum(bars, i) &&
        Number.isFinite(ma[i]!) &&
        bar.close >= ma[i]! &&
        dayKeyOf(bar.timestamp) >= startDate
      ) {
        points.push({ timestamp: bar.timestamp, signal: 'buy' })
        stopLow = prev.low
        // 开仓日自身放量即基准 / 创半年新高即记基准（B 日属持仓期第一天）
        if (volumeSpiked) {
          spikeClose = bar.close
        }
        if (isHalfYearHigh(bars, i)) {
          highClose = bar.close
          dropDays = 0
        }
      }
      continue
    }
    if (volumeSpiked) {
      spikeClose = bar.close
    }
    // S4 观察：新半年新高重记基准并清零；已武装时累计连续低于基准的收盘天数（收复基准即清零）
    if (isHalfYearHigh(bars, i)) {
      highClose = bar.close
      dropDays = 0
    } else if (highClose != null) {
      dropDays = bar.close < highClose ? dropDays + 1 : 0
    }
    // S5 观察：连续收盘低于上一交易日（收涨即清零），第 3 日确认三连阴并重记该日最低价为基准
    if (bar.close < prev.close) {
      downRun += 1
      if (downRun === SELL_DOWN_RUN_DAYS) {
        breakLow = bar.low
      }
    } else {
      downRun = 0
    }
    // S1/S2 价格离场（趋势乘骑分支）：成熟多头段（MA30 在 MA60 上方持续超过 15 日）
    // 改为收盘跌破 MA60 离场（替代 止损/MA30 双指标，骑趋势防震出）；
    // 否则维持原判定——S1 收盘跌破 B 前一日最低 / S2 连续两日收盘低于 MA30；
    // S3 放量破位：连续两日收盘跌破最近放量基准（基准当日收盘即基准，不会自触发）；
    // S4 高位破位：连续 3 日收盘跌破最近半年新高基准（基准当日收盘即基准，不会自触发）；
    // S5 连跌破位：连续两日收盘跌破最近三连阴第 3 日最低价（基准当日收盘 ≥ 自身最低价，不会自触发）
    const priceExit = trendRideAt(i)
      ? Number.isFinite(ma60[i]!) && bar.close < ma60[i]!
      : bar.close < stopLow || (belowMa(i) && belowMa(i - 1))
    if (
      priceExit ||
      (spikeClose != null && bar.close < spikeClose && prev.close < spikeClose) ||
      dropDays >= SELL_DROP_DAYS ||
      (breakLow != null && bar.close < breakLow && prev.close < breakLow)
    ) {
      points.push({ timestamp: bar.timestamp, signal: 'sell' })
      stopLow = null
      // S3 / S4 / S5 基准随离场复位：下一对 B/S 重新观察
      spikeClose = null
      highClose = null
      dropDays = 0
      downRun = 0
      breakLow = null
    }
  }
  return points
}

/** i 日是否为「连续 BUY_RUN_DAYS 日：每日最高价 > 前日最高价 且 收盘价 > 前日收盘价」的窗口末日 */
const isStrongRun = (bars: KLineData[], i: number): boolean => {
  for (let j = i - BUY_RUN_DAYS + 1; j <= i; j++) {
    const day = bars[j]!
    const prev = bars[j - 1]!
    if (!(day.high > prev.high && day.close > prev.close)) {
      return false
    }
  }
  return true
}

/**
 * 买动能保护（买入门槛②）：以 R1/R2/R3 记窗口第 1/2/3 日单日涨幅（vs 各自
 * 前一交易日收盘；isStrongRun 保证三者 > 0），涨幅真衰减且不能有效修复则
 * 不开仓——任一成立即拦：
 * ① R1 的 50% > R2 + R3（后两日合计接不回首日涨幅的一半）；
 * ② R2 的 15% > R3（第 3 日涨速衰竭至第 2 日的 15% 以下）。
 */
const day3KeepsMomentum = (bars: KLineData[], i: number): boolean => {
  const day3 = bars[i]!
  const day2 = bars[i - 1]!
  const day1 = bars[i - 2]!
  const day0 = bars[i - 3]!
  const r1 = (day1.close - day0.close) / day0.close
  const r2 = (day2.close - day1.close) / day1.close
  const r3 = (day3.close - day2.close) / day2.close
  return r2 + r3 >= BUY_TAIL_REPAIR_MIN * r1 && r3 >= BUY_FADE_RATIO * r2
}

/** i 日最高价是否创近 SELL_HIGH_LOOKBACK_BARS 个交易日（约半年）新高（严格高于回看内全部高点） */
const isHalfYearHigh = (bars: KLineData[], i: number): boolean => {
  if (i < SELL_HIGH_LOOKBACK_BARS) {
    return false
  }
  const high = bars[i]!.high
  for (let j = i - SELL_HIGH_LOOKBACK_BARS; j < i; j++) {
    if (bars[j]!.high >= high) {
      return false
    }
  }
  return true
}

/** 简单移动平均（前 period-1 根窗口不足为 NaN） */
const smaOf = (values: number[], period: number): number[] => {
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!
    if (i >= period) {
      sum -= values[i - period]!
    }
    out.push(i >= period - 1 ? sum / period : Number.NaN)
  }
  return out
}
