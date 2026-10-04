import type { KLineData } from 'klinecharts'
import type { BoardRankItem, QuoteSnapshot, SymbolSearchItem, TimeShareSnapshot } from '../../../chart/types'
import { TTLCache } from '../../cache'
import { getEnv } from '../../env'
import type { MarketDataProvider } from '../types'
import { fetchKLines } from './kline'
import { CN_TENCENT_PERIOD } from './parse'
import { fetchQuote, fetchQuotes } from './quote'
import { fetchBoardRanking } from './ranking'
import { searchSymbols } from './search'
import { fetchTimeShare } from './timeshare'

const MAX_CACHE_ENTRIES = 2_000

/** 腾讯能力：六类接口齐备；4h 无原生周期（缺口由 periods 声明，走基周期 + 本地聚合） */
export const TENCENT_CAPABILITIES = {
  timeShare: true,
  search: true,
  batchQuotes: true,
  boardRanking: true,
  periods: Object.keys(CN_TENCENT_PERIOD)
}

/**
 * 腾讯行情数据源（缓存策略属 provider 内部知识：raw/hist 分层、各 TTL 随 env 配置，
 * 缓存 key 带 tencent: 前缀避免跨数据源串数据）。
 */
export const createTencentProvider = (): MarketDataProvider => {
  const env = getEnv()
  const quoteCache = new TTLCache<QuoteSnapshot>({
    maxEntries: MAX_CACHE_ENTRIES,
    defaultTtlMs: env.CACHE_QUOTE_TTL_MS
  })
  const quotesCache = new TTLCache<QuoteSnapshot[]>({
    maxEntries: MAX_CACHE_ENTRIES,
    defaultTtlMs: env.CACHE_QUOTE_TTL_MS
  })
  const klineCache = new TTLCache<KLineData[]>({ maxEntries: MAX_CACHE_ENTRIES, defaultTtlMs: env.CACHE_KLINE_TTL_MS })
  const timeShareCache = new TTLCache<TimeShareSnapshot>({
    maxEntries: MAX_CACHE_ENTRIES,
    defaultTtlMs: env.CACHE_TIMESHARE_TTL_MS
  })
  const searchCache = new TTLCache<SymbolSearchItem[]>({
    maxEntries: MAX_CACHE_ENTRIES,
    defaultTtlMs: env.CACHE_SEARCH_TTL_MS
  })
  const rankCache = new TTLCache<BoardRankItem[]>({
    maxEntries: MAX_CACHE_ENTRIES,
    defaultTtlMs: env.CACHE_QUOTE_TTL_MS
  })

  return {
    id: 'tencent',
    capabilities: TENCENT_CAPABILITIES,
    fetchQuote: (symbol) => fetchQuote(quoteCache, symbol),
    fetchQuotes: (symbols) => fetchQuotes(quotesCache, symbols),
    fetchKLines: (symbol, period, from, to) => fetchKLines(klineCache, symbol, period, from, to),
    fetchTimeShare: (symbol) => fetchTimeShare(timeShareCache, symbol),
    searchSymbols: (query) => searchSymbols(searchCache, quoteCache, query),
    fetchBoardRanking: (board, sort, direction, limit) => fetchBoardRanking(rankCache, board, sort, direction, limit)
  }
}
