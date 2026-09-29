import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, queryObject, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { replayQuerySchema } from '@/lib/server/schemas'
import { fetchReplayBars } from '@/lib/server/replay-service'

export const dynamic = 'force-dynamic'

/** 回放数据编排：返回标的最近 N 根升序日 K（分页拼接，突破上游单页上限） */
export async function GET(request: NextRequest) {
  const log = requestLogger(requestIdOf(request))
  const parsed = replayQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid query')
  }
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  const { symbol, bars: targetBars } = parsed.data
  try {
    const data = await fetchReplayBars({ market: symbol.slice(0, 2), ticker: symbol.slice(2) }, targetBars)
    return jsonOk({ bars: data })
  } catch (error) {
    log.error({ err: String(error), symbol }, 'replay upstream failed')
    return jsonError(502, 'upstream_error', 'quote upstream temporarily unavailable')
  }
}
