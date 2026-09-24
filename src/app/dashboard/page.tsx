import type { Metadata } from 'next'
import TradingTerminal from '@/components/terminal/TradingTerminal'
import { DEFAULT_SYMBOL_CODE } from '@/lib/chart/constants'
import { parseSymbolCode } from '@/lib/chart/types'
import { fetchInitialTerminalData } from '@/lib/server/market-service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '行情看板',
  description:
    '基于 KLineChart v10 与腾讯行情的 A 股 K 线看板(A-share chart dashboard)：分时、多周期 K 线、技术指标与基本面数据。'
}

/** 看板页：默认展示上证指数（与默认标的列表一致），自首页入口进入 */
export default async function DashboardPage() {
  const parsed = parseSymbolCode(DEFAULT_SYMBOL_CODE)
  if (parsed == null) {
    throw new Error(`invalid default symbol: ${DEFAULT_SYMBOL_CODE}`)
  }
  const { quote, initialBars } = await fetchInitialTerminalData(parsed)
  return (
    <TradingTerminal market={parsed.market} ticker={parsed.ticker} initialQuote={quote} initialBars={initialBars} />
  )
}
