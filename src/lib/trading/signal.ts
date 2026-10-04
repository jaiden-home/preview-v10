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
/** 买入强度门槛：后两个交易日累计涨幅 ≥ 1% */
const BUY_TAIL_GAIN_MIN = 0.01
/** 卖出 S2 均线周期：30 日收盘均线（亦为买入门槛②「第 3 日收盘 ≥ 均线」的周期） */
const SELL_MA_DAYS = 30
/** 卖出 S3 放量倍数：当日成交量 ≥ 前一交易日的 3 倍 */
const SELL_SPIKE_RATIO = 3

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
 * ① 后两个交易日累计涨幅 ≥ 1%（第 3 日收盘相对窗口首日收盘）；
 * ② 第 3 日收盘价 ≥ 30 日均线（MA30 窗口不足不判定）。
 *
 * 卖出（S）：**B/S 成对交替**——B 后进入持仓态，S 出现前不再标 B（强势延续
 * 只续持、不加仓标记）；持仓期逐日判定，先触发者离场（一枚 B 对一枚 S）——
 * S1 止损：收盘价低于 B 点前一交易日的最低价；
 * S2 趋势离场：连续两日收盘价低于 30 日均线（MA30 窗口不足不判定）；
 * S3 放量破位：**持仓期**（B 日及之后，空仓不观察）当日成交量 ≥ 前一交易日
 * 的 3 倍时记录当日收盘价为观察基准（多枚基准以最近一枚为准），此后首次
 * 出现连续两日收盘低于该基准，第二日离场；基准随仓位生命周期走——离场
 * 即复位，下一对 B/S 重新观察（空仓期与起始日前的放量不记录）。
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

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]!
    const prev = bars[i - 1]!
    // S3 观察：放量 ≥ 前日 3 倍（仅持仓期记录，基准属于当前 B/S 对）
    const prevVol = prev.volume ?? 0
    const volumeSpiked = prevVol > 0 && (bar.volume ?? 0) >= prevVol * SELL_SPIKE_RATIO

    if (stopLow == null) {
      // B：空仓 + 连续 3 日（高点过高点、收盘过收盘）第 3 日 + 两项强化条件——
      // ① 后两个交易日累计涨幅 ≥ 1%（第 3 日收盘 vs 窗口首日收盘）② 第 3 日收盘 ≥ MA30；
      // 起始日起开仓并记止损基准，开仓日不判 S；起始日前的强涨不开仓（策略自起始日起始）
      if (
        i >= BUY_RUN_DAYS &&
        isStrongRun(bars, i) &&
        tailGainOf(bars, i) >= BUY_TAIL_GAIN_MIN &&
        Number.isFinite(ma[i]!) &&
        bar.close >= ma[i]! &&
        dayKeyOf(bar.timestamp) >= startDate
      ) {
        points.push({ timestamp: bar.timestamp, signal: 'buy' })
        stopLow = prev.low
        // 开仓日自身放量即基准（B 日属持仓期第一天）
        if (volumeSpiked) {
          spikeClose = bar.close
        }
      }
      continue
    }
    if (volumeSpiked) {
      spikeClose = bar.close
    }
    // S1 止损：收盘跌破 B 点前一日最低；S2 趋势离场：连续两日收盘低于 MA30；
    // S3 放量破位：连续两日收盘跌破最近放量基准（基准当日收盘即基准，不会自触发）
    if (
      bar.close < stopLow ||
      (belowMa(i) && belowMa(i - 1)) ||
      (spikeClose != null && bar.close < spikeClose && prev.close < spikeClose)
    ) {
      points.push({ timestamp: bar.timestamp, signal: 'sell' })
      stopLow = null
      // 基准随离场复位：下一对 B/S 从新放量重新观察
      spikeClose = null
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

/** 买入窗口「后两个交易日」累计涨幅：第 3 日收盘相对窗口首日收盘 */
const tailGainOf = (bars: KLineData[], i: number): number => {
  const base = bars[i - BUY_RUN_DAYS + 1]!.close
  return (bars[i]!.close - base) / base
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
