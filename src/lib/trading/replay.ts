// ==================== 加速回放引擎（纯函数，/simtrade 专用） ====================
// 日原子推进模型：开局选定起始日后，第 1 个交易日立即完成（整根 K 线出现），
// 此后每过固定 10 秒（REPLAY_SPEED_MS）完成下一个交易日——价格 = 当日收盘，
// 走满 dayCount 个交易日即本局结束。
// 成交时间戳 = 已完成虚拟日 15:00（本地时），dayKeyOf 反解回虚拟日期，
// account.ts 的 T+1 冻结/解冻与当日盈亏滚动零改动复用。
// 全部为环境无关纯函数（服务端结算与客户端展示共用）；会话权威状态由 BFF 持久化，K 线数据不落盘。

import type { KLineData } from 'klinecharts'
import { dayKeyOf, type TradingAccount } from './account'

/** 起始日前历史窗口根数（与 /trade 首次加载 BAR_LIMIT 对齐；起始日前不足则拉全量） */
export const PRE_START_WINDOW_BARS = 500

/** 回放单次拉取根数上限（/api/replay zod max 与客户端追拉目标的公共钳制值；纯护栏，正常会话远小于此） */
export const REPLAY_FETCH_MAX_BARS = 5000

/** 起始日最早可选日期（A 股上交所开市日；早于标的上市日时自然落到数据首日开局） */
export const EARLIEST_START_DATE = '1990-12-19'

/** 自然日 → 交易日估算（≈ 5/7，含节假日余量上取整）：追拉目标一步到位用，过冲无害 */
export const estimateTradingBars = (startDate: string, now: number = Date.now()): number => {
  const start = new Date(`${startDate}T00:00:00`).getTime()
  const calendarDays = Math.max(0, Math.ceil((now - start) / 86_400_000))
  return Math.ceil(calendarDays * (5 / 7)) + 10
}

/** 固定倍速：完成一个交易日的真实毫秒数（写死 10 秒，不提供档位选择） */
export const REPLAY_SPEED_MS = 10_000

export type ReplayStatus = 'running' | 'paused' | 'ended'

export interface ReplayState {
  status: ReplayStatus
  speedMs: 10_000
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

/** 日期键前推 1 年（闰日 2/29 回退 2/28；setup 默认起始日 = 结束日 - 1 年） */
export const yearBeforeKey = (dayKey: string): string => {
  const [y, m, d] = dayKey.split('-').map(Number)
  const date = new Date(y - 1, m - 1, d)
  if (date.getMonth() !== m - 1) {
    // 非闰年 2/29 滚到 3 月，回退到 2 月末
    date.setDate(0)
  }
  return dayKeyOf(date.getTime())
}

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

/** 自 startDate 起可模拟的交易日数（endDate（含）截断；缺省 = 到数据尽头） */
export const forwardCountOf = (bars: KLineData[], startDate: string, endDate?: string): number =>
  bars.filter((bar) => {
    const d = dateKeyOfBar(bar)
    return d >= startDate && (endDate == null || d <= endDate)
  }).length

/** 可选起始日范围：全历史任意可选（min = A 股开市日，早于上市日时落到数据首日开局）；
 *  max = 最新一根日 K（选它仍有 1 天，由"≥2 天"开局校验拦截）。
 *  选早于已加载窗口的日期时，可模拟天数本地只能算下界（追拉后由服务端权威校准） */
export interface ReplayStartRange {
  min: string
  max: string
}

export const startRangeOf = (bars: KLineData[]): ReplayStartRange | null => {
  if (bars.length < 3) {
    return null
  }
  return {
    min: EARLIEST_START_DATE,
    max: dateKeyOfBar(bars[bars.length - 1]!)
  }
}

/** 开局：第 1 个交易日立即完成（整根出现） */
export const createReplaySession = (anchorCode: string, startDate: string, dayCount: number): ReplayState => ({
  status: 'running',
  speedMs: REPLAY_SPEED_MS,
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
