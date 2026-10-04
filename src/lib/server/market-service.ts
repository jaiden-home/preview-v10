import type { KLineData, Period } from 'klinecharts'
import { BAR_LIMIT, TIMESPAN_MILLIS } from '../chart/constants'
import type {
  BoardRankItem,
  MarketOverview,
  QuoteSnapshot,
  SymbolRef,
  SymbolSearchItem,
  TimeShareSnapshot
} from '../chart/types'
import { isValidSymbolCode } from '../chart/types'
import { guessCnMarket } from '../chart/utils'
import { getProvider } from './provider/registry'
import type { BoardKind, BoardSortKey } from './provider/types'
import { ProviderError } from './provider/types'

// ==================== 行情服务（BFF 路由与页面的唯一入口） ====================
// 编排数据源实例：调用方只依赖本模块与领域模型，切换服务商仅改 DATA_PROVIDER 环境变量。

export const fetchQuote = (symbol: SymbolRef): Promise<QuoteSnapshot> => getProvider().fetchQuote(symbol)

export const fetchKLines = (symbol: SymbolRef, period: Period, from: number, to: number): Promise<KLineData[]> =>
  getProvider().fetchKLines(symbol, period, from, to)

/** 分时：数据源无原生接口时降级为当日 1 分钟 K 合成（date 保持 YYYYMMDD 口径） */
export const fetchTimeShare = async (symbol: SymbolRef): Promise<TimeShareSnapshot> => {
  const provider = getProvider()
  if (provider.capabilities.timeShare) {
    return provider.fetchTimeShare(symbol)
  }
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30).getTime()
  const [quote, bars] = await Promise.all([
    provider.fetchQuote(symbol),
    provider.fetchKLines(symbol, { span: 1, type: 'minute' }, from, now.getTime())
  ])
  if (bars.length === 0) {
    throw new ProviderError(`time share synthesis is empty for ${symbol.market}${symbol.ticker}`, provider.id)
  }
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return {
    date: `${now.getFullYear()}${month}${day}`,
    prevClose: quote.prevClose ?? bars[0].close,
    // 降级路径无官方 OHLC：由当日 1 分钟 K（真实分钟高低）合成
    open: bars[0].open,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    bars
  }
}

/** 搜索：数据源无名称联想能力时降级为 6 位代码精确匹配 */
export const searchSymbols = async (query: string): Promise<SymbolSearchItem[]> => {
  const provider = getProvider()
  if (provider.capabilities.search) {
    return provider.searchSymbols(query)
  }
  const codeMatch = query.trim().match(/^(sh|sz|bj)?(\d{6})$/i)
  if (codeMatch == null) {
    return []
  }
  const market = (codeMatch[1] ?? guessCnMarket(codeMatch[2])).toLowerCase()
  const ticker = codeMatch[2]
  try {
    const quote = await provider.fetchQuote({ market, ticker })
    return [{ ticker, name: quote.name ?? ticker, market }]
  } catch {
    return []
  }
}

// ==================== 行情中心总览（/market 页与 /api/market 的唯一入口） ====================

/** 指数条标的：上证指数 / 深证成指 / 创业板指 / 科创50 */
export const MARKET_INDEX_CODES = ['sh000001', 'sz399001', 'sz399006', 'sh000688'] as const

/** 板块榜单每页条数（行业 ~86 / 概念 ~400+，取头部足够） */
export const MARKET_RANK_LIMIT = 20

/** 自选行情批量上限（超出截断，防长串代码打爆上游 URL） */
export const MARKET_WATCH_LIMIT = 30

export interface MarketOverviewQuery {
  board: BoardKind
  sort: BoardSortKey
  direction: 'asc' | 'desc'
  watches: SymbolRef[]
}

/** 逗号分隔自选代码串 → 去重截断的 SymbolRef 列表（非法段直接丢弃） */
export const parseWatchCodes = (raw: string): SymbolRef[] => {
  const seen = new Set<string>()
  const refs: SymbolRef[] = []
  for (const token of raw.split(',')) {
    const code = token.trim()
    if (!isValidSymbolCode(code) || seen.has(code) || refs.length >= MARKET_WATCH_LIMIT) {
      continue
    }
    seen.add(code)
    refs.push({ market: code.slice(0, 2), ticker: code.slice(2) })
  }
  return refs
}

/** 批量行情：能力缺失时降级为逐标的拉取（单个失败置空价快照，不拖垮整批） */
const fetchQuotesResilient = async (symbols: SymbolRef[]): Promise<QuoteSnapshot[]> => {
  const provider = getProvider()
  if (symbols.length === 0) {
    return []
  }
  if (provider.capabilities.batchQuotes && provider.fetchQuotes != null) {
    return provider.fetchQuotes(symbols)
  }
  return Promise.all(
    symbols.map(async (symbol) => {
      try {
        return await provider.fetchQuote(symbol)
      } catch {
        return {
          market: symbol.market,
          ticker: symbol.ticker,
          name: null,
          price: null,
          prevClose: null,
          fundamental: {}
        }
      }
    })
  )
}

/** 行情中心总览：指数条 + 板块榜 + 自选行情一次拉齐；榜单能力缺失/上游失败降级为空榜 */
export const fetchMarketOverview = async (query: MarketOverviewQuery): Promise<MarketOverview> => {
  const provider = getProvider()
  const indexRefs = MARKET_INDEX_CODES.map((code) => ({ market: code.slice(0, 2), ticker: code.slice(2) }))
  const [indices, ranking, watches] = await Promise.all([
    fetchQuotesResilient(indexRefs),
    provider.capabilities.boardRanking && provider.fetchBoardRanking != null
      ? provider.fetchBoardRanking(query.board, query.sort, query.direction, MARKET_RANK_LIMIT).catch(() => [])
      : Promise.resolve([] as BoardRankItem[]),
    fetchQuotesResilient(query.watches)
  ])
  return { indices, ranking, watches }
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

  const provider = getProvider()
  const dayPeriod: Period = { span: 1, type: 'day' }
  const to = Date.now()
  const from = to - BAR_LIMIT * TIMESPAN_MILLIS.day
  const [quote, initialBars] = await Promise.all([
    withTimeout(provider.fetchQuote(symbol)),
    withTimeout(provider.fetchKLines(symbol, dayPeriod, from, to))
  ])
  return { quote, initialBars }
}
