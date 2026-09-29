import type { NextRequest } from 'next/server'
import { allowSimRequest, jsonError, jsonOk, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { simSessionSchema } from '@/lib/server/schemas'
import { SimTradingError } from '@/lib/server/trading/contract'
import { getTradingProvider } from '@/lib/server/trading/registry'
import { sidCookie, sidOf } from '@/lib/server/trading/sid'

export const dynamic = 'force-dynamic'

/** 模拟交易会话控制：start / pause / resume / speed / restart（服务端时钟权威） */
export async function POST(request: NextRequest) {
  if (!allowSimRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  const { sid, isNew } = sidOf(request)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'invalid_params', 'invalid json body')
  }
  const parsed = simSessionSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid body')
  }
  try {
    const state = await getTradingProvider().controlSession(sid, parsed.data)
    const response = jsonOk(state)
    if (isNew) {
      response.headers.append('Set-Cookie', sidCookie(sid))
    }
    return response
  } catch (error) {
    if (error instanceof SimTradingError) {
      return jsonError(422, error.simCode, error.message)
    }
    requestLogger(requestIdOf(request)).error({ err: String(error), sid }, 'sim session failed')
    return jsonError(502, 'upstream_error', 'sim trading temporarily unavailable')
  }
}
