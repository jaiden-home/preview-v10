import type { NextRequest } from 'next/server'
import { allowSimRequest, jsonError, jsonOk, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { getTradingProvider } from '@/lib/server/trading/registry'
import { sidCookie, sidOf } from '@/lib/server/trading/sid'

export const dynamic = 'force-dynamic'

/** 模拟交易状态：账户 + 回放会话快照（服务端时钟结算先行；live 轮询 ~1s 同步权威虚拟日） */
export async function GET(request: NextRequest) {
  if (!allowSimRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  const { sid, isNew } = sidOf(request)
  try {
    const state = await getTradingProvider().getState(sid)
    const response = jsonOk(state)
    if (isNew) {
      response.headers.append('Set-Cookie', sidCookie(sid))
    }
    return response
  } catch (error) {
    requestLogger(requestIdOf(request)).error({ err: String(error), sid }, 'sim state failed')
    return jsonError(502, 'upstream_error', 'sim trading temporarily unavailable')
  }
}
