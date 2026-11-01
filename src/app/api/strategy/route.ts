import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { DEFAULT_START, getStrategy } from '@/lib/server/market-db/strategy'
import { marketDbExists } from '@/lib/server/market-db/db'

export const dynamic = 'force-dynamic'

/** 策略模拟数据（A‴ 方案，market.db 只读快照计算；?start=YYYY-MM-DD 起始日、?refresh=1 绕过缓存重算） */
export async function GET(request: NextRequest) {
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  if (!marketDbExists()) {
    return jsonError(503, 'market_db_missing', 'market snapshot database not provisioned')
  }
  const log = requestLogger(requestIdOf(request))
  try {
    const params = new URL(request.url).searchParams
    const start = params.get('start') ?? DEFAULT_START
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return jsonError(400, 'bad_start', 'start must be YYYY-MM-DD')
    }
    const data = await getStrategy(start, params.get('refresh') === '1')
    if (data == null) {
      return jsonError(503, 'strategy_unavailable', 'strategy data not ready')
    }
    return jsonOk(data)
  } catch (error) {
    log.error({ err: String(error) }, 'strategy load failed')
    return jsonError(502, 'strategy_error', 'strategy data temporarily unavailable')
  }
}
