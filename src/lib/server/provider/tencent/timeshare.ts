import type { SymbolRef, TimeShareSnapshot } from '../../../chart/types'
import { symbolCode } from '../../../chart/types'
import { isCnStarMarket, localDayKey, parseCnBarTime, pickPrevClose } from '../../../chart/utils'
import type { TTLCache } from '../../cache'
import { fetchJson, UpstreamError } from './http'
import { parseTimeShareDay, parseTencentKlines } from './parse'

/** 从最近若干日 K 中补昨收（分时接口缺昨收时的兜底） */
const fetchPrevClose = async (symbol: SymbolRef, displayedDayKey: string, fallback: number): Promise<number> => {
  const code = symbolCode(symbol)
  try {
    const result = await fetchJson<Record<string, unknown>>(
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,6,`
    )
    const container = (result?.data as Record<string, Record<string, unknown>> | undefined)?.[code] ?? {}
    const days = parseTencentKlines(
      ((container?.day ?? []) as unknown[]).filter((row): row is unknown[] => Array.isArray(row))
    )
    if (days.length > 0) {
      return pickPrevClose(days, displayedDayKey, fallback)
    }
    // 日线缺失时退回 qt 实时数据，索引 4 为昨收
    const qt = (container?.qt as Record<string, unknown> | undefined)?.[code]
    if (Array.isArray(qt) && Number(qt[4]) > 0) {
      return Number(qt[4])
    }
    return fallback
  } catch {
    return fallback
  }
}

/** 官方分时接口：一次返回最新交易日每分钟价格、累计量/额与昨收（qt 索引 4） */
export const fetchTimeShare = async (
  cache: TTLCache<TimeShareSnapshot>,
  symbol: SymbolRef
): Promise<TimeShareSnapshot> => {
  const code = symbolCode(symbol)
  const star = isCnStarMarket(symbol)
  return cache.getOrLoad(`tencent:timeshare:${code}`, async () => {
    const result = await fetchJson<Record<string, unknown>>(
      `https://web.ifzq.gtimg.cn/appstock/app/day/query?code=${code}`
    )
    const container = (result?.data as Record<string, Record<string, unknown>> | undefined)?.[code] ?? {}
    const qt = (container?.qt as Record<string, unknown> | undefined)?.[code]
    const prevCloseFromQt = Array.isArray(qt) ? Number(qt[4]) : Number.NaN
    const days = (container?.data ?? []) as unknown[]
    let best: { date: string; points: unknown[] } | null = null
    for (const day of days) {
      const date = (day as { date?: unknown })?.date
      const points = (day as { data?: unknown })?.data
      if (typeof date === 'string' && /^\d{8}$/.test(date) && Array.isArray(points)) {
        // data 数组最新在前，取日期最大的一支
        if (best == null || date > best.date) {
          best = { date, points }
        }
      }
    }
    if (best == null) {
      throw new UpstreamError('time share data is empty', 'web.ifzq.gtimg.cn')
    }
    const fallbackPrice = Number.isFinite(prevCloseFromQt) && prevCloseFromQt > 0 ? prevCloseFromQt : Number.NaN
    // 科创板分时量为「股」（每手 200 股），其余板块为「手」（每手 100 股）
    const bars = parseTimeShareDay(best.date, best.points, fallbackPrice, star ? 200 : 1)
    if (bars.length === 0) {
      throw new UpstreamError('time share points are invalid', 'web.ifzq.gtimg.cn')
    }
    let prevClose = fallbackPrice
    if (!Number.isFinite(prevClose) || prevClose <= 0) {
      prevClose = await fetchPrevClose(symbol, localDayKey(parseCnBarTime(`${best.date}0930`)), bars[0].close)
    }
    return { date: best.date, prevClose, bars }
  })
}
