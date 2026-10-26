import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { getBoard } from '@/lib/server/market-db/board'
import { marketDbExists } from '@/lib/server/market-db/db'

export const dynamic = 'force-dynamic'

/** 领涨看板数据（market.db 只读快照：概览 + 概念热力四周期 + 趋势达标领涨股表；?refresh=1 绕过缓存重算） */
export async function GET(request: NextRequest) {
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  if (!marketDbExists()) {
    return jsonError(503, 'market_db_missing', 'market snapshot database not provisioned')
  }
  const log = requestLogger(requestIdOf(request))
  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === '1'
    const board = await getBoard(refresh)
    if (board == null) {
      return jsonError(503, 'board_unavailable', 'board data not ready')
    }
    return jsonOk(board)
  } catch (error) {
    log.error({ err: String(error) }, 'screener board load failed')
    return jsonError(502, 'board_error', 'board data temporarily unavailable')
  }
}
