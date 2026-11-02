import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { getStrategyBundle } from '@/lib/server/market-db/strategy'
import { marketDbExists } from '@/lib/server/market-db/db'

export const dynamic = 'force-dynamic'

/** 策略模拟数据（A‴ 方案，market.db 只读快照计算；全版本束 { active, order, versions }，?refresh=1 绕过缓存重算） */
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
    const bundle = await getStrategyBundle(params.get('refresh') === '1')
    if (bundle.versions[bundle.active] == null) {
      return jsonError(503, 'strategy_unavailable', 'strategy data not ready')
    }
    return jsonOk(bundle)
  } catch (error) {
    log.error({ err: String(error) }, 'strategy load failed')
    return jsonError(502, 'strategy_error', 'strategy data temporarily unavailable')
  }
}
