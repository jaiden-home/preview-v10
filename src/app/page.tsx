import TradingTerminal from '@/components/terminal/TradingTerminal'
import { DEFAULT_SYMBOL_CODE } from '@/lib/chart/constants'
import { parseSymbolCode } from '@/lib/chart/types'
import { fetchInitialTerminalData } from '@/lib/server/tencent'

export const dynamic = 'force-dynamic'

/** 首页：默认展示上证指数（与默认标的列表一致） */
export default async function HomePage() {
  const parsed = parseSymbolCode(DEFAULT_SYMBOL_CODE)
  if (parsed == null) {
    throw new Error(`invalid default symbol: ${DEFAULT_SYMBOL_CODE}`)
  }
  const { quote, initialBars } = await fetchInitialTerminalData(parsed)
  return (
    <TradingTerminal market={parsed.market} ticker={parsed.ticker} initialQuote={quote} initialBars={initialBars} />
  )
}
