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

/**
 * 逐日买卖点求值（纯函数，环境无关）：极速模拟页「当日买入点 / 卖出点」提示的规则域。
 *
 * - 输入为截至当前虚拟日的全部可见日 K（起始日前历史窗口 + 已完成模拟日），
 *   逐日**因果**判定（只用当日及之前的数据，无未来函数）；
 * - 仅 startDate（含）之后的模拟日产出信号点，起始日前历史只作计算上下文不出点；
 * - 随 dayIndex 推进逐日补点，最后一枚即「当日」提示；某日无信号则该日不标记。
 * - 纯客户端本地展示口径（对单一用户生效），不入服务端账务与成交链路。
 *
 * 买入规则（B）：当日为「连续 3 日强势上涨」的第 3 日——窗口内每日收盘价均
 * **高于上一交易日的最高价**（high ≥ close，收盘站上前日高点已隐含当日收涨）；
 * 滑动窗口判定，超过 3 日的强势段自第 3 日起每个构成完整窗口的交易日各出一枚 B。
 * 暂无卖出规则（卖出点规则候补后在本函数内补 'sell' 点即可）。
 */
export const dailySignals = (bars: KLineData[], startDate: string): SignalPoint[] => {
  const points: SignalPoint[] = []
  for (let i = BUY_RUN_DAYS; i < bars.length; i++) {
    let strongRun = true
    for (let j = i - BUY_RUN_DAYS + 1; j <= i; j++) {
      // 收盘 > 上一交易日最高（隐含逐日收涨）
      if (!(bars[j]!.close > bars[j - 1]!.high)) {
        strongRun = false
        break
      }
    }
    if (strongRun && dayKeyOf(bars[i]!.timestamp) >= startDate) {
      points.push({ timestamp: bars[i]!.timestamp, signal: 'buy' })
    }
  }
  return points
}
