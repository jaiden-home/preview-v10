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

/** 看板页：默认展示上证指数（与默认标的列表一致）；支持 ?symbol= 深链（行情中心跳转，非法代码回退默认） */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const params = await searchParams
  const requested = params.symbol != null ? parseSymbolCode(params.symbol) : null
  const parsed = requested ?? parseSymbolCode(DEFAULT_SYMBOL_CODE)
  if (parsed == null) {
    throw new Error(`invalid default symbol: ${DEFAULT_SYMBOL_CODE}`)
  }
  const { quote, initialBars } = await fetchInitialTerminalData(parsed)
  return (
    <TradingTerminal market={parsed.market} ticker={parsed.ticker} initialQuote={quote} initialBars={initialBars} />
  )
}
