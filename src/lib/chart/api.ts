import type { SimReplayView } from '@/lib/trading/protocol'
import type {
  MarketBoard,
  MarketBoardSort,
  MarketOverview,
  MarketSortDirection,
  SymbolSearchItem,
  QuoteSnapshot
} from './types'
import type { BoardData } from '../screener/types'

/** 客户端 BFF 请求封装（失败返回 null / 空数组，由调用方兜底） */

/** 回放视图：某标的在当前会话窗口的「历史 + 模拟日」日 K（/api/sim/replay，窗口由服务端从会话解析，仅 symbol 参数） */
export const fetchReplayView = async (code: string): Promise<SimReplayView | null> => {
  try {
    const response = await fetch(`/api/sim/replay?symbol=${code}`)
    if (!response.ok) {
      return null
    }
    return (await response.json()) as SimReplayView
  } catch {
    return null
  }
}

export const fetchQuoteSnapshot = async (code: string): Promise<QuoteSnapshot | null> => {
  try {
    const response = await fetch(`/api/quote?symbol=${code}`)
    if (!response.ok) {
      return null
    }
    return (await response.json()) as QuoteSnapshot
  } catch {
    return null
  }
}

export const fetchSymbolSearch = async (q: string): Promise<SymbolSearchItem[]> => {
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
    if (!response.ok) {
      return []
    }
    const data = (await response.json()) as { items: SymbolSearchItem[] }
    return data.items ?? []
  } catch {
    return []
  }
}

/** 行情中心总览（指数 + 板块榜 + 自选行情；symbols 为自选代码，空数组可省略） */
export const fetchMarketOverview = async (params: {
  board: MarketBoard
  sort: MarketBoardSort
  dir: MarketSortDirection
  symbols?: string[]
}): Promise<MarketOverview | null> => {
  const search = new URLSearchParams({ board: params.board, sort: params.sort, dir: params.dir })
  if (params.symbols != null && params.symbols.length > 0) {
    search.set('symbols', params.symbols.join(','))
  }
  try {
    const response = await fetch(`/api/market?${search.toString()}`)
    if (!response.ok) {
      return null
    }
    return (await response.json()) as MarketOverview
  } catch {
    return null
  }
}

export type BoardFetchResult = { ok: true; board: BoardData } | { ok: false; message: string }

/** 领涨看板数据（/api/screener/board；refresh=true 绕过服务端缓存重算，message 为双语目录格式文案） */
export const fetchBoardRequest = async (refresh = false): Promise<BoardFetchResult> => {
  try {
    const response = await fetch(`/api/screener/board${refresh ? '?refresh=1' : ''}`)
    const data: unknown = await response.json().catch(() => null)
    if (response.ok && data != null && typeof (data as BoardData).meta === 'object') {
      return { ok: true, board: data as BoardData }
    }
    const message = (data as { error?: { message?: string } })?.error?.message
    return { ok: false, message: message ?? '看板数据请求失败|Board request failed' }
  } catch {
    return { ok: false, message: '网络异常，请稍后重试|Network error, please retry' }
  }
}
