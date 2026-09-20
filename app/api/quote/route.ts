import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, queryObject, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { quoteQuerySchema } from '@/lib/server/schemas'
import { fetchCnQuote } from '@/lib/server/tencent'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const log = requestLogger(requestIdOf(request))
  const parsed = quoteQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid query')
  }
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  const { symbol } = parsed.data
  try {
    const quote = await fetchCnQuote({ market: symbol.slice(0, 2), ticker: symbol.slice(2) })
    return jsonOk(quote)
  } catch (error) {
    log.error({ err: String(error), symbol }, 'quote upstream failed')
    return jsonError(502, 'upstream_error', 'quote upstream temporarily unavailable')
  }
}
