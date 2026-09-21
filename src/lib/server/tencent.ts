import type { KLineData, Period } from 'klinecharts'
import { parseQtQuote } from '../fundamental'
import { BAR_LIMIT, CN_TENCENT_PERIOD, TIMESPAN_MILLIS, cnPeriodKey } from '../chart/constants'
import {
  aggregateBars,
  formatTencentDate,
  guessCnMarket,
  isCnStarMarket,
  localDayKey,
  parseCnBarTime,
  parseTencentKlines,
  pickPrevClose
} from '../chart/utils'
import { parseTimeShareDay } from '../chart/timeshare'
import type { QuoteSnapshot, SymbolRef, SymbolSearchItem, TimeShareSnapshot } from '../chart/types'
import { symbolCode } from '../chart/types'
import { TTLCache } from './cache'
import { getEnv } from './env'
import { logger } from './logger'

// ==================== 上游请求 ====================

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly upstream: string
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

const fetchUpstream = async (url: string): Promise<Response> => {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://gu.qq.com/' },
    signal: AbortSignal.timeout(getEnv().UPSTREAM_TIMEOUT_MS),
    // 服务端代理每次都要拿到最新行情，绕过 Next 数据缓存
    cache: 'no-store'
  })
  if (!response.ok) {
    throw new UpstreamError(`upstream responded ${response.status}`, url)
  }
  return response
}

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetchUpstream(url)
  return (await response.json()) as T
}

/** 腾讯部分接口返回 GBK 编码文本 */
const fetchGbkText = async (url: string): Promise<string> => {
  const response = await fetchUpstream(url)
  const buffer = await response.arrayBuffer()
  try {
    return new TextDecoder('gbk').decode(buffer)
  } catch (error) {
    // Node 构建未携带完整 ICU 时降级（中文可能乱码，但不阻断行情数字段）
    logger.warn({ err: String(error), url }, 'gbk decode unavailable, falling back to utf-8')
    return new TextDecoder('utf-8').decode(buffer)
  }
}

// ==================== 缓存实例 ====================

const env = () => getEnv()
const quoteCache = () => new TTLCache<QuoteSnapshot>({ maxEntries: 2_000, defaultTtlMs: env().CACHE_QUOTE_TTL_MS })
const klineCache = () => new TTLCache<KLineData[]>({ maxEntries: 2_000, defaultTtlMs: env().CACHE_KLINE_TTL_MS })
const timeShareCache = () =>
  new TTLCache<TimeShareSnapshot>({ maxEntries: 2_000, defaultTtlMs: env().CACHE_TIMESHARE_TTL_MS })
const searchCache = () =>
  new TTLCache<SymbolSearchItem[]>({ maxEntries: 2_000, defaultTtlMs: env().CACHE_SEARCH_TTL_MS })

// 模块级单例（同进程内共享；测试中通过 resetServerCaches 重建）
let quoteCacheInstance: ReturnType<typeof quoteCache> | undefined
let klineCacheInstance: ReturnType<typeof klineCache> | undefined
let timeShareCacheInstance: ReturnType<typeof timeShareCache> | undefined
let searchCacheInstance: ReturnType<typeof searchCache> | undefined

const caches = () => {
  quoteCacheInstance ??= quoteCache()
  klineCacheInstance ??= klineCache()
  timeShareCacheInstance ??= timeShareCache()
  searchCacheInstance ??= searchCache()
  return {
    quote: quoteCacheInstance,
    kline: klineCacheInstance,
    timeShare: timeShareCacheInstance,
    search: searchCacheInstance
  }
}

/** 仅测试使用：重置缓存单例 */
export const resetServerCaches = (): void => {
  quoteCacheInstance = undefined
  klineCacheInstance = undefined
  timeShareCacheInstance = undefined
  searchCacheInstance = undefined
}

// ==================== 实时行情 / 基本面 ====================

/** 腾讯实时行情：名称 + 现价/昨收 + 基本面（原浏览器直连逻辑服务端化） */
export const fetchCnQuote = async (symbol: SymbolRef): Promise<QuoteSnapshot> => {
  const code = symbolCode(symbol)
  return caches().quote.getOrLoad(
    `quote:${code}`,
    async () => {
      const text = await fetchGbkText(`https://qt.gtimg.cn/q=${code}`)
      const parsed = parseQtQuote(text, code)
      if (parsed.invalid) {
        throw new UpstreamError(`quote parse failed for ${code}`, 'qt.gtimg.cn')
      }
      return {
        market: symbol.market,
        ticker: symbol.ticker,
        name: parsed.name,
        price: parsed.price,
        prevClose: parsed.prevClose,
        fundamental: parsed.fundamental
      }
    },
    env().CACHE_QUOTE_TTL_MS
  )
}

// ==================== K 线 ====================

/** K 线拉取（分钟线走 mkline，日/周/月走 fqkline 前复权；不支持周期本地聚合） */
export const fetchCnKLines = async (
  symbol: SymbolRef,
  period: Period,
  from: number,
  to: number
): Promise<KLineData[]> => {
  const code = symbolCode(symbol)
  const key = CN_TENCENT_PERIOD[cnPeriodKey(period)]
  let periodKey = key
  let aggregateMillis: number | null = null
  if (key == null) {
    // 腾讯不支持的周期（如 4 时）用 60 分钟线拉取后本地聚合
    periodKey = period.type === 'hour' ? 'm60' : 'day'
    aggregateMillis = period.span * TIMESPAN_MILLIS[period.type]
  }
  return caches().kline.getOrLoad(
    `kline:${code}:${cnPeriodKey(period)}:${from}:${to}`,
    async () => {
      // 腾讯接口带 end 日期时会漏掉"当天"这根 bar（end 写成未来日期也一样），窗口覆盖今天时 end 必须留空
      const endParam = formatTencentDate(to) === formatTencentDate(Date.now()) ? '' : formatTencentDate(to)
      // 分钟线接口仅支持 m1/m5/m15/m30/m60；用 /^m\d/ 匹配，避免 'month' 误入分钟接口
      const url = /^m\d/.test(periodKey)
        ? `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${code},${periodKey},,640`
        : `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},${periodKey},${formatTencentDate(from)},${endParam},640,qfq`
      const result = await fetchJson<Record<string, unknown>>(url)
      const container = (result?.data as Record<string, Record<string, unknown>> | undefined)?.[code] ?? {}
      const rows = ((container[`qfq${periodKey}`] ?? container[periodKey] ?? []) as unknown[]).filter(
        (row): row is unknown[] => Array.isArray(row)
      )
      let dataList = parseTencentKlines(rows)
        .filter((d) => d.timestamp >= from && d.timestamp <= to)
        .slice(-BAR_LIMIT)
      if (aggregateMillis != null) {
        dataList = aggregateBars(dataList, aggregateMillis)
      }
      return dataList
    },
    env().CACHE_KLINE_TTL_MS
  )
}

// ==================== 分时 ====================

/** 从最近若干日 K 中补昨收（分时接口缺昨收时的兜底） */
const fetchCnPrevClose = async (symbol: SymbolRef, displayedDayKey: string, fallback: number): Promise<number> => {
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
export const fetchCnTimeShare = async (symbol: SymbolRef): Promise<TimeShareSnapshot> => {
  const code = symbolCode(symbol)
  const star = isCnStarMarket(symbol)
  return caches().timeShare.getOrLoad(
    `timeshare:${code}`,
    async () => {
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
        prevClose = await fetchCnPrevClose(symbol, localDayKey(parseCnBarTime(`${best.date}0930`)), bars[0].close)
      }
      return { date: best.date, prevClose, bars }
    },
    env().CACHE_TIMESHARE_TTL_MS
  )
}

// ==================== 标的搜索 ====================

const SMARTBOX_MARKETS = new Set(['sh', 'sz', 'bj'])

/**
 * smartbox 联想接口解析（服务端无 CORS 限制，解锁按名称搜索）。
 * 返回形如 v_hint=["sh600519~贵州茅台~gp~sh",...] 的 GBK 文本，格式随版本略有差异，做防御性解析。
 */
export const parseSmartboxResponse = (text: string, limit = 10): SymbolSearchItem[] => {
  const arrayMatch = text.match(/\[[\s\S]*\]/)
  if (arrayMatch == null) {
    return []
  }
  let entries: unknown[]
  try {
    entries = JSON.parse(arrayMatch[0].replace(/'/g, '"')) as unknown[]
  } catch {
    return []
  }
  const items: SymbolSearchItem[] = []
  for (const entry of entries) {
    if (typeof entry !== 'string' || items.length >= limit) {
      continue
    }
    const parts = entry.split('~')
    const codeToken = parts.find((part) => /^(sh|sz|bj)\d{6}$/.test(part))
    if (codeToken == null) {
      continue
    }
    const market = codeToken.slice(0, 2)
    if (!SMARTBOX_MARKETS.has(market)) {
      continue
    }
    const ticker = codeToken.slice(2)
    // 名称：优先取独立 6 位代码段之外的中文段，回退首段
    const name =
      parts.find(
        (part) => part !== codeToken && /[\u4e00-\u9fa5A-Za-z]/.test(part) && !/^(gp|zs|fund|hk|us)$/i.test(part)
      ) ?? parts[0]
    items.push({ ticker, name: String(name), market })
  }
  return items
}

/**
 * 标的搜索：6 位代码精确匹配（原有行为），否则走 smartbox 名称联想。
 * smartbox 无结果时代码可猜测时回退 qt 名称补全。
 */
export const searchCnSymbols = async (query: string): Promise<SymbolSearchItem[]> => {
  const q = query.trim()
  if (q === '') {
    return []
  }
  return caches().search.getOrLoad(
    `search:${q.toLowerCase()}`,
    async () => {
      const codeMatch = q.match(/^(sh|sz|bj)?(\d{6})$/i)
      if (codeMatch != null) {
        const market = (codeMatch[1] ?? guessCnMarket(codeMatch[2])).toLowerCase()
        const ticker = codeMatch[2]
        try {
          const quote = await fetchCnQuote({ market, ticker })
          return [{ ticker, name: quote.name ?? ticker, market }]
        } catch {
          return []
        }
      }
      // 名称/拼音联想：服务端直连 smartbox（浏览器端因无 CORS 头不可用）
      try {
        const text = await fetchGbkText(`https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(q)}&t=all`)
        const items = parseSmartboxResponse(text)
        if (items.length > 0) {
          return items
        }
      } catch (error) {
        logger.warn({ err: String(error), q }, 'smartbox search failed')
      }
      return []
    },
    env().CACHE_SEARCH_TTL_MS
  )
}

/** 供页面 SSR 使用的聚合快照（行情 + 初始日 K） */
export interface InitialTerminalPayload {
  quote: QuoteSnapshot | null
  initialBars: KLineData[] | null
}

export const fetchInitialTerminalData = async (
  symbol: SymbolRef,
  timeoutMs = 3_000
): Promise<InitialTerminalPayload> => {
  const withTimeout = <T>(task: Promise<T>): Promise<T | null> =>
    Promise.race([task, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]).catch(() => null)

  const dayPeriod: Period = { span: 1, type: 'day' }
  const to = Date.now()
  const from = to - BAR_LIMIT * TIMESPAN_MILLIS.day
  const [quote, initialBars] = await Promise.all([
    withTimeout(fetchCnQuote(symbol)),
    withTimeout(fetchCnKLines(symbol, dayPeriod, from, to))
  ])
  return { quote, initialBars }
}
