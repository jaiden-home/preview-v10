import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, queryObject, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { searchQuerySchema } from '@/lib/server/schemas'
import { searchSymbols } from '@/lib/server/market-service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const log = requestLogger(requestIdOf(request))
  const parsed = searchQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid query')
  }
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  try {
    const items = await searchSymbols(parsed.data.q)
    return jsonOk({ items })
  } catch (error) {
    log.error({ err: String(error), q: parsed.data.q }, 'search upstream failed')
    return jsonError(502, 'upstream_error', 'search upstream temporarily unavailable')
  }
}
