// ==================== 加速回放引擎（纯函数，/simtrade 专用） ====================
// 日原子推进模型：开局选定起始日后，第 1 个交易日立即完成（整根 K 线出现），
// 此后每过 speedMs（15/30/60 秒）完成下一个交易日——价格 = 当日收盘，
// 走满 dayCount 个交易日即本局结束。
// 成交时间戳 = 已完成虚拟日 15:00（本地时），dayKeyOf 反解回虚拟日期，
// account.ts 的 T+1 冻结/解冻与当日盈亏滚动零改动复用。
// 全部为环境无关纯函数（服务端结算与客户端展示共用）；会话权威状态由 BFF 持久化，K 线数据不落盘。

import type { KLineData } from 'klinecharts'
import { dayKeyOf, type TradingAccount } from './account'

/** 倍速档位：真实毫秒数 = 完成一个交易日 */
export const REPLAY_SPEEDS = [15_000, 30_000, 60_000] as const
export type ReplaySpeedMs = (typeof REPLAY_SPEEDS)[number]

export type ReplayStatus = 'running' | 'paused' | 'ended'

export interface ReplayState {
  status: ReplayStatus
  speedMs: ReplaySpeedMs
  /** 锚定标的（开局时的选中标的，提供共享交易日历） */
  anchorCode: string
  /** 第 1 个模拟日 yyyy-mm-dd */
  startDate: string
  /** 模拟总交易日数 */
  dayCount: number
  /** 已完成的模拟日数（开局即 1；结束态 = dayCount） */
  dayIndex: number
}

/** bar 时间戳 -> yyyy-mm-dd */
export const dateKeyOfBar = (bar: KLineData): string => dayKeyOf(bar.timestamp)

/** 虚拟成交时间戳：虚拟日 15:00（本地时）；dayKeyOf(virtualTsOf(k)) === k */
export const virtualTsOf = (dayKey: string): number => {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(y, m - 1, d, 15, 0, 0, 0).getTime()
}

/** 共享交易日历：锚定标的自 startDate 起（含）的交易日日期序列（升序） */
export const calendarFrom = (bars: KLineData[], startDate: string): string[] =>
  bars.filter((bar) => dateKeyOfBar(bar) >= startDate).map(dateKeyOfBar)

/** 自 startDate 起可模拟的交易日数 */
export const forwardCountOf = (bars: KLineData[], startDate: string): number =>
  bars.filter((bar) => dateKeyOfBar(bar) >= startDate).length

/** 可选起始日范围：数据集内任意可选（能模拟几天由数据决定）；
 *  min 取第二根（首根无昨收上下文），max = 最新一根日 K（选它仍有 1 天，由"≥2 天"开局校验拦截） */
export interface ReplayStartRange {
  min: string
  max: string
}

export const startRangeOf = (bars: KLineData[]): ReplayStartRange | null => {
  if (bars.length < 3) {
    return null
  }
  return {
    min: dateKeyOfBar(bars[1]!),
    max: dateKeyOfBar(bars[bars.length - 1]!)
  }
}

/** 开局：第 1 个交易日立即完成（整根出现） */
export const createReplaySession = (
  anchorCode: string,
  startDate: string,
  dayCount: number,
  speedMs: ReplaySpeedMs = REPLAY_SPEEDS[1]
): ReplayState => ({
  status: 'running',
  speedMs,
  anchorCode,
  startDate,
  dayCount: Math.max(1, dayCount),
  dayIndex: 1
})

/** 完成下一个交易日；走满 dayCount 置 ended */
export const advanceDay = (state: ReplayState): ReplayState => {
  if (state.status !== 'running') {
    return state
  }
  if (state.dayIndex >= state.dayCount) {
    return { ...state, status: 'ended' }
  }
  return { ...state, dayIndex: state.dayIndex + 1 }
}

/** 市场基准日：第 dayIndex 个模拟日（含）；dayIndex=0（未开始）= 起始日之前 */
const lastIndexOf = (bars: KLineData[], dayIndex: number, calendar: string[]): number => {
  if (calendar.length === 0) {
    return -1
  }
  const boundary = dayIndex > 0 ? calendar[Math.min(dayIndex, calendar.length) - 1] : calendar[0]
  let last = -1
  for (let i = 0; i < bars.length; i += 1) {
    const d = dateKeyOfBar(bars[i])
    if (dayIndex > 0 ? d <= boundary : d < boundary) {
      last = i
    } else {
      break
    }
  }
  return last
}

/** 当前市场态：最新完成日收盘价 + 前收（停牌缺日沿用最近一根收盘） */
export interface ReplayQuote {
  price: number
  /** 前收（可见序列首根无前收为 null，涨跌停校验跳过） */
  prevClose: number | null
}

export const replayQuoteOf = (bars: KLineData[], dayIndex: number, calendar: string[]): ReplayQuote | null => {
  const last = lastIndexOf(bars, dayIndex, calendar)
  if (last < 0) {
    return null
  }
  return {
    price: bars[last].close,
    prevClose: last > 0 ? bars[last - 1].close : null
  }
}

/** 图表可见日 K：起始日之前的历史 + 已完成的模拟日（升序） */
export const visibleDailyBarsOf = (bars: KLineData[], dayIndex: number, calendar: string[]): KLineData[] =>
  bars.slice(0, lastIndexOf(bars, dayIndex, calendar) + 1)

/**
 * 回放开局：真实日期（晚于虚拟起点）建仓的冻结仓位视为历史持仓，全部转为可卖——
 * 未开局阶段按实时行情交易的仓位，进入回放后不因虚拟时钟早于建仓日而永久冻结。
 */
export const releaseAllFrozen = (account: TradingAccount): TradingAccount => {
  if (!account.positions.some((p) => p.frozenQty > 0)) {
    return account
  }
  return {
    ...account,
    positions: account.positions.map((p) =>
      p.frozenQty > 0 ? { ...p, availableQty: p.qty, frozenQty: 0, frozenDate: '' } : p
    )
  }
}
