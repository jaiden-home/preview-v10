// ==================== 模拟交易传输协议（环境无关，客户端与服务端共用） ====================
// simtrade 交易逻辑已上移 BFF：本文件定义 /api/sim/* 的请求/响应 DTO，
// 只依赖 account.ts / replay.ts 的环境无关类型，可被 SSR、客户端与 lib/server 共同引用。
// 日后接入真实交易接口时，替换的是服务端 provider 实现，本协议与前端展示层不动。

import type { OrderRejectCode, TradeSide, TradingAccount } from './account'
import type { ReplaySpeedMs, ReplayState } from './replay'

/** 服务端回放会话：ReplayState + 服务端时钟锚点（lastTickAt 起的墙钟流逝 = 虚拟日推进） */
export interface SimSession extends ReplayState {
  lastTickAt: number
}

/**
 * 服务端时钟推进（客户端与服务端共用同一实现，零口径漂移）：
 * running 时按 serverNow - lastTickAt 推进整数个虚拟日（保留余数进度），走满置 ended。
 * 服务端用它持久化结算（每个请求先 settle）；客户端用它本地派生展示态（不轮询），
 * 任何服务端交互（下单/暂停/继续/倍速）的响应都会带回权威 session 校准。
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

/** /api/sim/state 与各写操作的成功响应体 */
export interface SimState {
  account: TradingAccount
  /** null = 未开局（setup 阶段，按实时行情交易） */
  session: SimSession | null
  /** 服务端当前时间（客户端进度条时钟校准） */
  serverNow: number
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
  | { action: 'start'; anchorCode: string; startDate: string; speedMs: ReplaySpeedMs }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'speed'; speedMs: ReplaySpeedMs }
  | { action: 'restart' }

/** 模拟交易域错误码（下单拒绝与会话控制共用；OrderRejectCode 之外补充编排层错误） */
export type SimErrorCode =
  OrderRejectCode | 'quote_unavailable' | 'session_not_running' | 'no_active_session' | 'insufficient_history'
