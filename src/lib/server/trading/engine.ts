// ==================== 模拟交易撮合编排（可注入行情源与时钟，纯逻辑可测） ====================
// 复用 lib/trading 环境无关纯函数（account.ts 账务规则 / replay.ts 回放模型）做服务端权威结算：
// 服务端时钟结算（虚拟日推进 + 跨日账务）、下单校验执行、开局编排。持久化由 provider 层负责。

import type { KLineData } from 'klinecharts'
import {
  calcEquity,
  dayKeyOf,
  executeBuy,
  executeSell,
  unfreezePositions,
  validateOrder,
  type TradingAccount
} from '@/lib/trading/account'
import type { ReplaySpeedMs } from '@/lib/trading/replay'
import {
  PRE_START_WINDOW_BARS,
  calendarFrom,
  createReplaySession,
  releaseAllFrozen,
  replayQuoteOf,
  virtualTsOf
} from '@/lib/trading/replay'
import { advanceSessionBy, type SimOrderInput, type SimSession, type SimSessionAction } from '@/lib/trading/protocol'
import { fetchQuote } from '../market-service'
import { fetchReplayBars } from '../replay-service'
import { SimTradingError } from './contract'

/** 撮合与结算所需行情源（local provider 默认用 BFF 既有服务装配；测试注入 stub） */
export interface MarketSource {
  /** 实时行情（setup 阶段交易与名称兜底） */
  liveQuote(code: string): Promise<{ name: string | null; price: number | null; prevClose: number | null } | null>
  /** 全量历史日 K（升序；回放阶段校验与结算） */
  replayBars(code: string): Promise<KLineData[]>
}

// ==================== 时钟与跨日结算 ====================

// 时钟推进统一走 protocol.advanceSessionBy（客户端展示派生与服务端持久化结算共用，零口径漂移）

/** 各持仓在虚拟日的收盘价（停牌缺日沿用最近一根收盘；无数据回退成本价） */
export const closePricesAt = (
  account: TradingAccount,
  barsByCode: Map<string, KLineData[]>,
  virtualDay: string
): Record<string, number> => {
  const prices: Record<string, number> = {}
  for (const p of account.positions) {
    const bars = barsByCode.get(p.code)
    let close: number | null = null
    if (bars != null) {
      // 该虚拟日（含）之前最近一根收盘：升序遍历取最后一个 <= virtualDay
      for (const bar of bars) {
        if (dayKeyOf(bar.timestamp) <= virtualDay) {
          close = bar.close
        } else {
          break
        }
      }
    }
    prices[p.code] = close ?? p.costPrice
  }
  return prices
}

export interface SettledSim {
  account: TradingAccount
  session: SimSession | null
  /** session 或账户发生变化（需持久化） */
  changed: boolean
}

/** 服务端时钟结算总入口：推进虚拟日并做账户跨日结算（T+1 解冻 + 当日盈亏基准滚动） */
export const settleSim = async (
  account: TradingAccount,
  session: SimSession | null,
  now: number,
  source: MarketSource
): Promise<SettledSim> => {
  if (session == null || session.status !== 'running') {
    return { account, session, changed: false }
  }
  const next = advanceSessionBy(session, now)
  if (next === session) {
    return { account, session, changed: false }
  }
  const anchorBars = await source.replayBars(session.anchorCode)
  const calendar = calendarFrom(anchorBars, session.startDate)
  const virtualDay = calendar[next.dayIndex - 1] ?? next.startDate
  const barsByCode = await barsForCodes([session.anchorCode, ...account.positions.map((p) => p.code)], source)
  barsByCode.set(session.anchorCode, anchorBars)
  const settledAccount = settleAccountDay(account, virtualDay, closePricesAt(account, barsByCode, virtualDay))
  return { account: settledAccount, session: next, changed: true }
}

// ==================== 下单 ====================

export interface OrderExecution {
  account: TradingAccount
  session: SimSession | null
  /** session 因时钟结算推进（需持久化） */
  sessionChanged: boolean
}

/** 下单编排：先结算时钟，再按阶段（setup 实时 / live 回放）解析行情权威，校验后成交 */
export const placeOrderEngine = async (
  account: TradingAccount,
  session: SimSession | null,
  order: SimOrderInput,
  now: number,
  source: MarketSource
): Promise<OrderExecution> => {
  const settled = await settleSim(account, session, now, source)
  const { account: base, session: sess } = settled
  if (sess != null && sess.status !== 'running') {
    throw new SimTradingError(
      'session_not_running',
      sess.status === 'ended'
        ? '本局已结束，点「再来一局」重开|Session ended, press Play again to restart'
        : '已暂停，点「继续」后才能下单|Paused, press Resume to trade'
    )
  }

  let prevClose: number | null
  let name: string
  let ts: number
  if (sess != null) {
    // live：现价/前收 = 回放行情（最新完成日收盘 + 前收），成交时间戳 = 虚拟日 15:00
    const anchorBars = await source.replayBars(sess.anchorCode)
    const calendar = calendarFrom(anchorBars, sess.startDate)
    const bars = sess.anchorCode === order.code ? anchorBars : await source.replayBars(order.code)
    const quote = replayQuoteOf(bars, sess.dayIndex, calendar)
    if (quote == null) {
      throw new SimTradingError('quote_unavailable', '行情加载中，请稍候|Quotes loading, please wait')
    }
    prevClose = quote.prevClose
    name = order.name ?? (await source.liveQuote(order.code))?.name ?? order.code
    ts = virtualTsOf(calendar[sess.dayIndex - 1] ?? sess.startDate)
  } else {
    // setup：实时行情（与 /trade 一致），成交时间戳 = 服务端当前时间
    const quote = await source.liveQuote(order.code)
    if (quote?.price == null || quote.prevClose == null) {
      throw new SimTradingError('quote_unavailable', '行情加载中，请稍候|Quotes loading, please wait')
    }
    prevClose = quote.prevClose
    name = order.name ?? quote.name ?? order.code
    ts = now
  }

  const rejection = validateOrder({
    account: base,
    side: order.side,
    code: order.code,
    price: order.price,
    qty: order.qty,
    prevClose
  })
  if (rejection != null) {
    throw new SimTradingError(rejection.code, rejection.message)
  }
  const input = { code: order.code, name, price: order.price, qty: order.qty, ts }
  const executed = order.side === 'buy' ? executeBuy(base, input) : executeSell(base, input)
  return { account: executed, session: sess, sessionChanged: settled.changed }
}

// ==================== 会话控制 ====================

export interface StartSessionParams {
  anchorCode: string
  startDate: string
  speedMs: ReplaySpeedMs
}

/** 开局：校验数据可行性（≥2 个交易日），建立会话并把账户结算到第 1 个虚拟日（历史建仓全部解冻） */
export const startSessionEngine = async (
  account: TradingAccount,
  params: StartSessionParams,
  now: number,
  source: MarketSource
): Promise<{ account: TradingAccount; session: SimSession }> => {
  const bars = await source.replayBars(params.anchorCode)
  if (bars.length < 3) {
    throw new SimTradingError('insufficient_history', '回放数据不足，无法开始模拟|Insufficient replay data to start')
  }
  const calendar = calendarFrom(bars, params.startDate)
  if (calendar.length < 2) {
    throw new SimTradingError(
      'insufficient_history',
      '交易日不足，请选择更早的起始日期|Not enough trading days; pick an earlier start date'
    )
  }
  const session: SimSession = {
    ...createReplaySession(params.anchorCode, params.startDate, calendar.length, params.speedMs),
    lastTickAt: now
  }
  const barsByCode = await barsForCodes([params.anchorCode, ...account.positions.map((p) => p.code)], source)
  barsByCode.set(params.anchorCode, bars)
  const virtualDay = calendar[0]!
  const settledAccount = settleAccountDay(account, virtualDay, closePricesAt(account, barsByCode, virtualDay))
  return { account: settledAccount, session }
}

/** 会话状态转移（start/restart 由 provider 专门处理，此处只做 pause/resume/speed） */
export const applySessionControl = (
  session: SimSession | null,
  action: SimSessionAction,
  now: number
): SimSession | null => {
  if (session == null) {
    return null
  }
  switch (action.action) {
    case 'pause':
      return session.status === 'running' ? { ...session, status: 'paused' } : session
    case 'resume':
      return session.status === 'paused' ? { ...session, status: 'running', lastTickAt: now } : session
    case 'speed':
      return {
        ...session,
        speedMs: action.speedMs,
        // running 换速当前日重新计时；paused 保持原锚点不动
        lastTickAt: session.status === 'running' ? now : session.lastTickAt
      }
    default:
      return session
  }
}

// ==================== 内部工具 ====================

/** 虚拟日界的账户结算：解冻（开局前真实日期建仓视为历史持仓全部可卖）+ 当日盈亏基准滚动 */
const settleAccountDay = (
  account: TradingAccount,
  virtualDay: string,
  closePrices: Record<string, number>
): TradingAccount => {
  const rolled = account.dayKey > virtualDay ? releaseAllFrozen(account) : unfreezePositions(account, virtualDay)
  const { totalAssets } = calcEquity(rolled, closePrices)
  return { ...rolled, dayKey: virtualDay, dayStartEquity: totalAssets }
}

/** 并行拉取一组标的的全量日 K（去重；失败不阻断——结算价格回退成本价） */
const barsForCodes = async (codes: string[], source: MarketSource): Promise<Map<string, KLineData[]>> => {
  const unique = Array.from(new Set(codes.filter((code) => code.length > 0)))
  const entries = await Promise.all(
    unique.map(async (code) => [code, await source.replayBars(code).catch(() => [])] as const)
  )
  return new Map(entries)
}

// ==================== 默认行情源（BFF 既有服务装配） ====================

/** bars 进程内缓存 TTL（与 CACHE_KLINE_HIST_TTL_MS 对齐：历史不可变，除权后定时全量刷新） */
const REPLAY_BARS_CACHE_TTL_MS = 600_000
/** 回放/结算所需日 K 根数上限（历史窗口 + 足够模拟天数；replay-service 会回溯到数据尽头） */
const REPLAY_BARS_LIMIT = PRE_START_WINDOW_BARS + 1500

/** 默认行情源：实时行情走 market-service（上游有 TTL 缓存），历史日 K 走 replay-service */
export const createMarketSource = (): MarketSource => {
  const barsCache = new Map<string, { at: number; bars: KLineData[] }>()
  return {
    liveQuote: async (code) => {
      try {
        const quote = await fetchQuote({ market: code.slice(0, 2), ticker: code.slice(2) })
        return { name: quote.name, price: quote.price, prevClose: quote.prevClose }
      } catch {
        return null
      }
    },
    replayBars: async (code) => {
      const hit = barsCache.get(code)
      if (hit != null && Date.now() - hit.at < REPLAY_BARS_CACHE_TTL_MS) {
        return hit.bars
      }
      const bars = await fetchReplayBars({ market: code.slice(0, 2), ticker: code.slice(2) }, REPLAY_BARS_LIMIT)
      barsCache.set(code, { at: Date.now(), bars })
      return bars
    }
  }
}
