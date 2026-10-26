import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { screenerRunSchema } from '@/lib/server/schemas'
import { MarketDbMissingError, runScreener, ScreenerValidationError } from '@/lib/server/screener/service'

export const dynamic = 'force-dynamic'

/** 量化选股运行（分片渐进）：done=false 时客户端带同参数继续请求，服务端按游标续算 */
export async function POST(request: NextRequest) {
  const log = requestLogger(requestIdOf(request))
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'invalid_params', 'body must be json')
  }
  const parsed = screenerRunSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid body')
  }
  try {
    const view = await runScreener(parsed.data)
    return jsonOk(view)
  } catch (error) {
    if (error instanceof ScreenerValidationError) {
      return jsonError(422, 'invalid_conditions', error.message)
    }
    if (error instanceof MarketDbMissingError) {
      return jsonError(503, 'market_db_missing', error.message)
    }
    log.error({ err: String(error) }, 'screener run failed')
    return jsonError(502, 'upstream_error', 'screener temporarily unavailable')
  }
}
