import { NextResponse, type NextRequest } from 'next/server'
import { allowSimRequest, jsonError, jsonOk, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { simOrderSchema } from '@/lib/server/schemas'
import { getTradingProvider } from '@/lib/server/trading/registry'
import { sidCookie, sidOf } from '@/lib/server/trading/sid'

export const dynamic = 'force-dynamic'

/** 模拟交易下单：服务端权威校验（涨跌停/整手/资金/T+1）与成交（虚拟时间戳由会话推导） */
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
  const parsed = simOrderSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid body')
  }
  try {
    const result = await getTradingProvider().placeOrder(sid, parsed.data)
    const response = result.ok
      ? jsonOk(result.state)
      : NextResponse.json(result, { status: 422, headers: { 'Cache-Control': 'no-store' } })
    if (isNew) {
      response.headers.append('Set-Cookie', sidCookie(sid))
    }
    return response
  } catch (error) {
    requestLogger(requestIdOf(request)).error({ err: String(error), sid }, 'sim order failed')
    return jsonError(502, 'upstream_error', 'sim trading temporarily unavailable')
  }
}
