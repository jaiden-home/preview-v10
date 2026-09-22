import type { QuoteSnapshot, SymbolSearchItem } from '../../../chart/types'
import { guessCnMarket } from '../../../chart/utils'
import type { TTLCache } from '../../cache'
import { logger } from '../../logger'
import { fetchGbkText } from './http'
import { parseSmartboxResponse } from './parse'
import { fetchQuote } from './quote'

/**
 * 标的搜索：6 位代码精确匹配，否则走 smartbox 名称联想。
 * smartbox 无结果时代码可猜测时回退 qt 名称补全。
 */
export const searchSymbols = async (
  searchCache: TTLCache<SymbolSearchItem[]>,
  quoteCache: TTLCache<QuoteSnapshot>,
  query: string
): Promise<SymbolSearchItem[]> => {
  const q = query.trim()
  if (q === '') {
    return []
  }
  return searchCache.getOrLoad(`tencent:search:${q.toLowerCase()}`, async () => {
    const codeMatch = q.match(/^(sh|sz|bj)?(\d{6})$/i)
    if (codeMatch != null) {
      const market = (codeMatch[1] ?? guessCnMarket(codeMatch[2])).toLowerCase()
      const ticker = codeMatch[2]
      try {
        const quote = await fetchQuote(quoteCache, { market, ticker })
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
  })
}
