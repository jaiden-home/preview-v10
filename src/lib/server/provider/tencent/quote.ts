import type { QuoteSnapshot, SymbolRef } from '../../../chart/types'
import { symbolCode } from '../../../chart/types'
import type { TTLCache } from '../../cache'
import { fetchGbkText, UpstreamError } from './http'
import { parseQtQuote } from './parse'

/** 腾讯实时行情：名称 + 现价/昨收 + 基本面（原浏览器直连逻辑服务端化） */
export const fetchQuote = async (cache: TTLCache<QuoteSnapshot>, symbol: SymbolRef): Promise<QuoteSnapshot> => {
  const code = symbolCode(symbol)
  return cache.getOrLoad(`tencent:quote:${code}`, async () => {
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
  })
}

/**
 * 批量实时行情：q= 支持逗号分隔多标的，一次请求拉齐（指数条/自选共用）。
 * 整批共享一条缓存（key 为代码序列）；任一标的缺失时该标的置空价快照而非整批失败。
 */
export const fetchQuotes = async (cache: TTLCache<QuoteSnapshot[]>, symbols: SymbolRef[]): Promise<QuoteSnapshot[]> => {
  if (symbols.length === 0) {
    return []
  }
  const codes = symbols.map(symbolCode)
  return cache.getOrLoad(`tencent:quotes:${codes.join(',')}`, async () => {
    const text = await fetchGbkText(`https://qt.gtimg.cn/q=${codes.join(',')}`)
    return symbols.map((symbol) => {
      const parsed = parseQtQuote(text, symbolCode(symbol))
      return {
        market: symbol.market,
        ticker: symbol.ticker,
        name: parsed.invalid ? null : parsed.name,
        price: parsed.price,
        prevClose: parsed.prevClose,
        fundamental: parsed.fundamental
      }
    })
  })
}
