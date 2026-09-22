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
