import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, queryObject, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { klineQuerySchema } from '@/lib/server/schemas'
import { fetchCnKLines } from '@/lib/server/tencent'
import { findPeriodOption } from '@/lib/chart/constants'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const log = requestLogger(requestIdOf(request))
  const parsed = klineQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid query')
  }
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  const { symbol, period: periodKey, from, to } = parsed.data
  const option = findPeriodOption(periodKey)
  if (option == null) {
    return jsonError(400, 'invalid_params', `unsupported period: ${periodKey}`)
  }
  try {
    const bars = await fetchCnKLines(
      { market: symbol.slice(0, 2), ticker: symbol.slice(2) },
      { span: option.span, type: option.type },
      from,
      to
    )
    return jsonOk({ bars })
  } catch (error) {
    log.error({ err: String(error), symbol, period: periodKey }, 'kline upstream failed')
    return jsonError(502, 'upstream_error', 'quote upstream temporarily unavailable')
  }
}
