import type { NextRequest } from 'next/server'
import { allowSimRequest, jsonError, jsonOk, queryObject, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import { replayQuerySchema } from '@/lib/server/schemas'
import { fetchQuote } from '@/lib/server/market-service'
import { fetchReplayBars } from '@/lib/server/replay-service'
import { getTradingProvider } from '@/lib/server/trading/registry'
import { sidOf } from '@/lib/server/trading/sid'
import { PRE_START_WINDOW_BARS, dateKeyOfBar, splitReplayView } from '@/lib/trading/replay'

export const dynamic = 'force-dynamic'

/**
 * 回放视图编排（/api/sim/replay，sid cookie 同路径域）：
 * 按当前会话窗口返回某标的的「历史 + 模拟日」日 K + 标的名称——
 * 除 symbol（资源标识）外无任何参数，窗口与名称全部由服务端解析。
 */
export async function GET(request: NextRequest) {
  const log = requestLogger(requestIdOf(request))
  const parsed = replayQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid query')
  }
  if (!allowSimRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  const { symbol } = parsed.data
  const symbolRef = { market: symbol.slice(0, 2), ticker: symbol.slice(2) }
  const { sid } = sidOf(request)
  try {
    const state = await getTradingProvider().getState(sid)
    const session = state.session
    const anchorDays = state.replay?.simDays ?? []
    if (session == null || anchorDays.length === 0) {
      return jsonError(422, 'insufficient_history', '回放视图不可用，请稍候|Replay view unavailable')
    }
    // 窗口右边界 = 会话最后一个模拟日（锚定日历），拉「右边界前 500 历史 + dayCount」再按区间切分；
    // 名称走实时行情兜底（上游 TTL 缓存），失败不阻断（前端回退代码）
    const endDay = dateKeyOfBar(anchorDays[anchorDays.length - 1]!)
    const [bars, quote] = await Promise.all([
      fetchReplayBars(symbolRef, PRE_START_WINDOW_BARS + session.dayCount, endDay),
      fetchQuote(symbolRef).catch(() => null)
    ])
    return jsonOk({ code: symbol, name: quote?.name ?? null, ...splitReplayView(bars, session.startDate, endDay) })
  } catch (error) {
    log.error({ err: String(error), symbol }, 'replay upstream failed')
    return jsonError(502, 'upstream_error', 'quote upstream temporarily unavailable')
  }
}
