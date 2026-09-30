import type { SimReplayView } from '@/lib/trading/protocol'
import type { SymbolSearchItem, QuoteSnapshot } from './types'

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
