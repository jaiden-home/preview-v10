import type { KLineData, Period } from 'klinecharts'
import { BAR_LIMIT, TIMESPAN_MILLIS } from '../chart/constants'
import type { QuoteSnapshot, SymbolRef, SymbolSearchItem, TimeShareSnapshot } from '../chart/types'
import { guessCnMarket } from '../chart/utils'
import { getProvider } from './provider/registry'
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
