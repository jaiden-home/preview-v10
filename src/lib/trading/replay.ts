// ==================== 加速回放引擎（纯函数，/simtrade 专用） ====================
// 日原子推进模型：开局选定起始日后，第 1 个交易日立即完成（整根 K 线出现），
// 此后每过档位时长（REPLAY_SPEED_PRESETS_MS，默认 10 秒）完成下一个交易日——价格 = 当日收盘，
// 走满 dayCount 个交易日即本局结束。
// 成交时间戳 = 已完成虚拟日 15:00（本地时），dayKeyOf 反解回虚拟日期，
// account.ts 的 T+1 冻结/解冻与当日盈亏滚动零改动复用。
// 全部为环境无关纯函数（服务端结算与客户端展示共用）；会话权威状态由 BFF 持久化，K 线数据不落盘。

import type { KLineData } from 'klinecharts'
import { dayKeyOf, type TradingAccount } from './account'

/** 起始日前历史窗口根数（起始日前不足则拉全量） */
export const PRE_START_WINDOW_BARS = 200

/** 回放单次拉取根数上限（/api/sim/replay zod max 的护栏值；正常会话远小于此） */
export const REPLAY_FETCH_MAX_BARS = 5000

/** 基准倍速：默认档位 = 1 个交易日 10 秒（无会话 boot 与表单默认值） */
export const REPLAY_SPEED_MS = 10_000

/** 倍速档位（模拟设置页分段；每交易日真实毫秒） */
export const REPLAY_SPEED_PRESETS_MS = [10_000, 15_000, 30_000, 60_000] as const

/** 每交易日毫秒 -> 就近档位（服务端 speedMs 反查展示用） */
export const nearestSpeedPresetMs = (speedMs: number): (typeof REPLAY_SPEED_PRESETS_MS)[number] =>
  REPLAY_SPEED_PRESETS_MS.reduce(
    (best, p) => (Math.abs(p - speedMs) < Math.abs(best - speedMs) ? p : best),
    REPLAY_SPEED_PRESETS_MS[0]
  )

/** 自动开局固定区间（含两端；/simtrade 无会话 boot 与设置页默认值共用） */
export const AUTO_START_DATE = '2024-01-01'
export const AUTO_END_DATE = '2025-01-01'

export type ReplayStatus = 'running' | 'paused' | 'ended'

export interface ReplayState {
  status: ReplayStatus
  /** 完成一个交易日的真实毫秒（档位见 REPLAY_SPEED_PRESETS_MS） */
  speedMs: number
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

/** 共享交易日历：锚定标的自 startDate 起（含）的交易日日期序列（升序）；endDate（含）截断本局 */
export const calendarFrom = (bars: KLineData[], startDate: string, endDate?: string): string[] =>
  bars
    .filter((bar) => {
      const d = dateKeyOfBar(bar)
      return d >= startDate && (endDate == null || d <= endDate)
    })
    .map(dateKeyOfBar)

/** 回放视图切分（服务端视图构建与前端共用口径）：
 *  history = 起始日之前的历史（升序，取末尾 PRE_START_WINDOW_BARS 根）；
 *  simDays = 模拟日区间 [startDate, endDay]（含两端，升序） */
export const splitReplayView = (
  bars: KLineData[],
  startDate: string,
  endDay: string
): { history: KLineData[]; simDays: KLineData[] } => {
  const history: KLineData[] = []
  const simDays: KLineData[] = []
  for (const bar of bars) {
    const d = dateKeyOfBar(bar)
    if (d < startDate) {
      history.push(bar)
    } else if (d <= endDay) {
      simDays.push(bar)
    }
  }
  return { history: history.slice(-PRE_START_WINDOW_BARS), simDays }
}

/** 开局：第 1 个交易日立即完成（整根出现）；speedMs 缺省 = REPLAY_SPEED_MS（10 秒） */
export const createReplaySession = (
  anchorCode: string,
  startDate: string,
  dayCount: number,
  speedMs: number = REPLAY_SPEED_MS
): ReplayState => ({
  status: 'running',
  speedMs,
  anchorCode,
  startDate,
  dayCount: Math.max(1, dayCount),
  dayIndex: 1
})

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
