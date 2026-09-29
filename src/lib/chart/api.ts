import type { KLineData } from 'klinecharts'
import type { SymbolSearchItem, QuoteSnapshot } from './types'

/** 客户端 BFF 请求封装（失败返回 null / 空数组，由调用方兜底） */

/** 回放数据源：最近 bars 根升序日 K（BFF 分页拼接，突破上游单页上限） */
export const fetchReplayBars = async (code: string, bars: number = 800): Promise<KLineData[]> => {
  try {
    const response = await fetch(`/api/replay?symbol=${code}&bars=${bars}`)
    if (!response.ok) {
      return []
    }
    const data = (await response.json()) as { bars: KLineData[] }
    return data.bars ?? []
  } catch {
    return []
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
