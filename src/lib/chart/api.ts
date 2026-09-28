import type { KLineData } from 'klinecharts'
import type { SymbolSearchItem, QuoteSnapshot } from './types'

/** 客户端 BFF 请求封装（失败返回 null / 空数组，由调用方兜底） */

/** 拉取历史日 K（极速模拟回放数据源；period 固定 1d，from/to 为毫秒时间戳） */
export const fetchDailyBars = async (code: string, from: number, to: number): Promise<KLineData[]> => {
  try {
    const response = await fetch(`/api/kline?symbol=${code}&period=1d&from=${from}&to=${to}`)
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
