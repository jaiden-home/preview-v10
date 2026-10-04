// ==================== 模拟交易 BFF 请求封装（仅客户端） ====================
// 失败返回 null / 业务拒绝体，由调用方兜底；账户与会话的权威状态一律来自服务端响应。

import { msg } from './messages'
import type { SimOrderInput, SimOrderResult, SimSessionAction, SimSessionResult, SimState } from './protocol'

/** 账户 + 会话快照（页面初始化与 live 轮询） */
export const fetchSimState = async (): Promise<SimState | null> => {
  try {
    const response = await fetch('/api/sim/state')
    if (!response.ok) {
      return null
    }
    return (await response.json()) as SimState
  } catch {
    return null
  }
}

/** 下单：422 拒单（业务校验失败）也返回结构化结果；网络/服务异常返回 null */
export const postSimOrder = async (order: SimOrderInput): Promise<SimOrderResult | null> => {
  try {
    const response = await fetch('/api/sim/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    })
    if (response.status === 422) {
      return (await response.json()) as SimOrderResult
    }
    if (!response.ok) {
      return null
    }
    return { ok: true, state: (await response.json()) as SimState }
  } catch {
    return null
  }
}

/** 会话控制（start/pause/resume/speed/restart）：422 拒绝解包 jsonError 信封带文案；网络/服务异常返回 null */
export const postSimSession = async (action: SimSessionAction): Promise<SimSessionResult | null> => {
  try {
    const response = await fetch('/api/sim/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action)
    })
    if (response.status === 422) {
      const body = (await response.json()) as { error?: { message?: string } }
      return { ok: false, message: body.error?.message ?? msg('start_failed') }
    }
    if (!response.ok) {
      return null
    }
    return { ok: true, state: (await response.json()) as SimState }
  } catch {
    return null
  }
}
