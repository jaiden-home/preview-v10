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
/** 买动能保护：缩量且涨速收窄时，第 3 日/第 2 日涨幅比下限 */
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
 * ② 动能保护：第 3 日涨幅与成交量**均**低于第 2 日（缩量且涨速收窄）时，
 *    第 3 日/第 2 日涨幅比 ≥ 0.15（涨速可衰减、不可衰竭；放量或涨速不降则不受限）。
 *
 * 卖出（S）：**B/S 成对交替**——B 后进入持仓态，S 出现前不再标 B（强势延续
 * 只续持、不加仓标记）；持仓期逐日判定，先触发者离场（一枚 B 对一枚 S）——
 * S1 止损：收盘价低于 B 点前一交易日的最低价；
 * S2 趋势离场：连续两日收盘价低于 30 日均线（MA30 窗口不足不判定）；
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
 * 连续 3 个交易日收盘低于该最低价，第三日离场；基准随离场即复位（空仓
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
      // ① 第 3 日收盘 ≥ MA30 ② 动能保护：缩量且涨速收窄时 第 3 日/第 2 日涨幅比 ≥ 0.15；
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
    // S1 止损：收盘跌破 B 点前一日最低；S2 趋势离场：连续两日收盘低于 MA30；
    // S3 放量破位：连续两日收盘跌破最近放量基准（基准当日收盘即基准，不会自触发）；
    // S4 高位破位：连续 3 日收盘跌破最近半年新高基准（基准当日收盘即基准，不会自触发）；
    // S5 连跌破位：连续 3 日收盘跌破最近三连阴第 3 日最低价（基准当日收盘 ≥ 自身最低价，不会自触发）
    if (
      bar.close < stopLow ||
      (belowMa(i) && belowMa(i - 1)) ||
      (spikeClose != null && bar.close < spikeClose && prev.close < spikeClose) ||
      dropDays >= SELL_DROP_DAYS ||
      (breakLow != null && bar.close < breakLow && prev.close < breakLow && bars[i - 2]!.close < breakLow)
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
 * 买动能保护（买入门槛②）：第 3 日涨幅与成交量**均**低于第 2 日（缩量且涨速收窄）时，
 * 第 3 日/第 2 日涨幅比须 ≥ BUY_FADE_RATIO；放量或涨速不降则不受限（恒过）。
 * 调用前提：isStrongRun 已保证第 2 日收涨（day2Gain > 0，比值分母安全）。
 */
const day3KeepsMomentum = (bars: KLineData[], i: number): boolean => {
  const day3 = bars[i]!
  const day2 = bars[i - 1]!
  const day1 = bars[i - 2]!
  const day2Gain = (day2.close - day1.close) / day1.close
  const day3Gain = (day3.close - day2.close) / day2.close
  if (!(day3Gain < day2Gain && (day3.volume ?? 0) < (day2.volume ?? 0))) {
    return true
  }
  return day3Gain / day2Gain >= BUY_FADE_RATIO
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
