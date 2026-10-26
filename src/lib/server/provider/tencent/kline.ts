import type { KLineData, Period } from 'klinecharts'
import { BAR_LIMIT, cnPeriodKey } from '../../../chart/constants'
import type { SymbolRef } from '../../../chart/types'
import { symbolCode } from '../../../chart/types'
import { aggregateBars } from '../../../chart/utils'
import type { TTLCache } from '../../cache'
import { getEnv } from '../../env'
import { planPeriod } from '../periods'
import { fetchIfzqJson, fetchJson } from './http'
import { CN_TENCENT_PERIOD, formatTencentDate, parseTencentKlines } from './parse'

/** 腾讯 K 线响应 → 原始 bars（不含任何请求窗口裁剪，保证缓存内容与窗口无关） */
const parseKlineRows = (code: string, periodKey: string, result: Record<string, unknown>): KLineData[] => {
  const container = (result?.data as Record<string, Record<string, unknown>> | undefined)?.[code] ?? {}
  const rows = ((container[`qfq${periodKey}`] ?? container[periodKey] ?? []) as unknown[]).filter(
    (row): row is unknown[] => Array.isArray(row)
  )
  return parseTencentKlines(rows)
}

// fqkline 走 ifzq 双域名互备（http.ts：无前缀域名优先，web. 风控漂移时自动切换）；
// mkline 仅无前缀域名可用（单域名）。
const fetchFqkline = async (code: string, periodKey: string, path: string): Promise<KLineData[]> =>
  parseKlineRows(code, periodKey, await fetchIfzqJson<Record<string, unknown>>(path))

/**
 * 近端原始 K 线（每 code×上游周期一份，全体用户共享）。
 * 缓存不过滤窗口、不截断、不聚合——依赖 from/to 的裁剪一律放在缓存外，
 * 不同窗口的请求互不污染；回源频率因此与用户数无关（TTL 内每 key 至多 1 次上游）。
 */
const fetchRawKLines = (cache: TTLCache<KLineData[]>, code: string, periodKey: string): Promise<KLineData[]> =>
  cache.getOrLoad(`tencent:kline:raw:${code}:${periodKey}`, async () => {
    // 分钟线接口仅支持 m1/m5/m15/m30/m60；用 /^m\d/ 匹配，避免 'month' 误入分钟接口
    if (/^m\d/.test(periodKey)) {
      const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${code},${periodKey},,640`
      return parseKlineRows(code, periodKey, await fetchJson<Record<string, unknown>>(url))
    }
    return fetchFqkline(code, periodKey, `/appstock/app/fqkline/get?param=${code},${periodKey},,,640,qfq`)
  })

/**
 * 历史 K 线窗口（仅日/周/月，窗口越过近端 640 根边界时使用）。
 * from/to 由真实 bar 时间戳锚定（确定性）且历史数据不可变，直接作缓存 key 安全；
 * 前复权在除权日会全历史重算，TTL 保持有界（默认 10 分钟）避免长期陈旧。
 */
const fetchHistoricalKLines = (
  cache: TTLCache<KLineData[]>,
  code: string,
  periodKey: string,
  from: number,
  to: number
): Promise<KLineData[]> =>
  cache.getOrLoad(
    `tencent:kline:hist:${code}:${periodKey}:${from}:${to}`,
    async () => {
      // 腾讯接口带 end 日期时会漏掉"当天"这根 bar（end 写成未来日期也一样），窗口覆盖今天时 end 必须留空
      const endParam = formatTencentDate(to) === formatTencentDate(Date.now()) ? '' : formatTencentDate(to)
      const rows = await fetchFqkline(
        code,
        periodKey,
        `/appstock/app/fqkline/get?param=${code},${periodKey},${formatTencentDate(from)},${endParam},640,qfq`
      )
      return rows.filter((d) => d.timestamp >= from && d.timestamp <= to).slice(-BAR_LIMIT)
    },
    getEnv().CACHE_KLINE_HIST_TTL_MS
  )

/**
 * K 线拉取（分钟线走 mkline，日/周/月走 fqkline 前复权；腾讯不支持的周期本地聚合）。
 * 路由：窗口完全落在近端 640 根内 → 共享 raw 缓存后按请求裁剪（多用户合并回源）；
 * 日/周/月窗口需要更早历史 → 按 from/to 走历史缓存（与直连行为一致）；
 * 分钟族上游仅有最近 640 分钟，直接裁剪（更早窗口恒为空，与直连一致）。
 */
export const fetchKLines = async (
  cache: TTLCache<KLineData[]>,
  symbol: SymbolRef,
  period: Period,
  from: number,
  to: number
): Promise<KLineData[]> => {
  const code = symbolCode(symbol)
  const plan = planPeriod(period, (candidate) => CN_TENCENT_PERIOD[cnPeriodKey(candidate)] != null)
  const periodKey = CN_TENCENT_PERIOD[cnPeriodKey(plan.base)]
  const raw = await fetchRawKLines(cache, code, periodKey)
  const oldest = raw[0]?.timestamp
  let dataList: KLineData[]
  if (oldest != null && from < oldest && !/^m\d/.test(periodKey)) {
    dataList = await fetchHistoricalKLines(cache, code, periodKey, from, to)
  } else {
    dataList = raw.filter((d) => d.timestamp >= from && d.timestamp <= to).slice(-BAR_LIMIT)
  }
  if (plan.aggregateMillis != null) {
    dataList = aggregateBars(dataList, plan.aggregateMillis)
  }
  return dataList
}
