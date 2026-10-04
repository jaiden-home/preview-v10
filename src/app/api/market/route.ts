import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, queryObject, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { marketQuerySchema } from '@/lib/server/schemas'
import { fetchMarketOverview, parseWatchCodes } from '@/lib/server/market-service'

export const dynamic = 'force-dynamic'

/** 行情中心总览：指数条 + 板块榜（board/sort/dir）+ 自选行情（symbols 批量） */
export async function GET(request: NextRequest) {
  const log = requestLogger(requestIdOf(request))
  const parsed = marketQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid query')
  }
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  const { board, sort, dir, symbols } = parsed.data
  try {
    const overview = await fetchMarketOverview({
      board,
      sort,
      direction: dir,
      watches: symbols != null ? parseWatchCodes(symbols) : []
    })
    return jsonOk(overview)
  } catch (error) {
    log.error({ err: String(error), board, sort, dir }, 'market overview upstream failed')
    return jsonError(502, 'upstream_error', 'market overview temporarily unavailable')
  }
}
