// ==================== 模拟交易传输协议（环境无关，客户端与服务端共用） ====================
// simtrade 交易逻辑已上移 BFF：本文件定义 /api/sim/* 的请求/响应 DTO，
// 只依赖 account.ts / replay.ts 的环境无关类型，可被 SSR、客户端与 lib/server 共同引用。
// 日后接入真实交易接口时，替换的是服务端 provider 实现，本协议与前端展示层不动。

import type { KLineData } from 'klinecharts'
import type { OrderRejectCode, TradeSide, TradingAccount } from './account'
import type { ReplayState } from './replay'

/** 服务端回放会话：ReplayState + 服务端时钟锚点（lastTickAt 起的墙钟流逝 = 虚拟日推进） */
export interface SimSession extends ReplayState {
  lastTickAt: number
}

/**
 * 服务端时钟推进（客户端与服务端共用同一实现，零口径漂移）：
 * running 时按 serverNow - lastTickAt 推进整数个虚拟日（保留余数进度），走满置 ended。
 * 服务端用它持久化结算（每个请求先 settle）；客户端用它本地派生展示态（不轮询），
 * 任何服务端交互（下单/暂停/继续/重开）的响应都会带回权威 session 校准。
 */
export const advanceSessionBy = (session: SimSession, serverNow: number): SimSession => {
  if (session.status !== 'running') {
    return session
  }
  const days = Math.floor((serverNow - session.lastTickAt) / session.speedMs)
  if (days <= 0) {
    return session
  }
  const dayIndex = Math.min(session.dayCount, session.dayIndex + days)
  return {
    ...session,
    dayIndex,
    status: dayIndex >= session.dayCount ? 'ended' : 'running',
    lastTickAt: session.lastTickAt + days * session.speedMs
  }
}

/** 回放视图数据（服务端算好、前端直接渲染）：
 *  name = 标的名称（服务端实时行情兜底，无则 null，前端回退代码）；
 *  history = 起始日之前的 历史 日 K（升序，≤ PRE_START_WINDOW_BARS）；
 *  simDays = 模拟日日 K（升序，全量 dayCount 根，含未完成日——前端按 dayIndex 逐日揭示） */
export interface SimReplayView {
  code: string
  name: string | null
  history: KLineData[]
  simDays: KLineData[]
}

/** /api/sim/state 与各写操作的成功响应体 */
export interface SimState {
  account: TradingAccount
  /** null = 未开局（自动开局在途/失败） */
  session: SimSession | null
  /** 服务端当前时间（客户端进度条时钟校准） */
  serverNow: number
  /** 锚定标的回放视图（有会话时随 state/start 返回；前端零参数一次拿全展示数据） */
  replay?: SimReplayView
}

/** 下单请求体（/api/sim/orders） */
export interface SimOrderInput {
  side: TradeSide
  /** sh/sz/bj + 6 位代码 */
  code: string
  price: number
  qty: number
  /** 标的名称（回放阶段无实时名称，客户端行情缓存直供；服务端兜底实时行情） */
  name?: string
}

/** 下单响应：成交带回最新状态；拒绝带错误码与双语文案键 */
export type SimOrderResult = { ok: true; state: SimState } | { ok: false; code: SimErrorCode; message: string }

/** 会话控制请求体（/api/sim/session） */
export type SimSessionAction =
  | {
      action: 'start'
      anchorCode: string
      startDate: string
      /** 结束日（含）；缺省 = 回放至数据尽头。仅用于开局圈定 dayCount，会话内以 dayCount 为权威 */
      endDate?: string
      /** 开局即暂停（自动开局用：第 1 天停住，点「继续」才开始计时） */
      paused?: boolean
    }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'restart' }

/** 会话控制响应：成功带回权威状态；422 业务拒绝带双语文案（jsonError 信封解包） */
export type SimSessionResult = { ok: true; state: SimState } | { ok: false; message: string }

/** 模拟交易域错误码（下单拒绝与会话控制共用；OrderRejectCode 之外补充编排层错误） */
export type SimErrorCode =
  OrderRejectCode | 'quote_unavailable' | 'session_not_running' | 'no_active_session' | 'insufficient_history'
