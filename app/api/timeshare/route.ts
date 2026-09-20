import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, queryObject, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { timeShareQuerySchema } from '@/lib/server/schemas'
import { fetchCnTimeShare } from '@/lib/server/tencent'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const log = requestLogger(requestIdOf(request))
  const parsed = timeShareQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid query')
  }
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  const { symbol } = parsed.data
  try {
    const snapshot = await fetchCnTimeShare({ market: symbol.slice(0, 2), ticker: symbol.slice(2) })
    return jsonOk(snapshot)
  } catch (error) {
    log.error({ err: String(error), symbol }, 'timeshare upstream failed')
    return jsonError(502, 'upstream_error', 'quote upstream temporarily unavailable')
  }
}
