import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import TradingTerminal from '@/components/terminal/TradingTerminal'
import { parseSymbolCode } from '@/lib/chart/types'
import { fetchInitialTerminalData, fetchQuote } from '@/lib/server/market-service'

export const dynamic = 'force-dynamic'

interface SymbolPageProps {
  params: Promise<{ symbol: string }>
}

const parseOrNotFound = (raw: string) => parseSymbolCode(raw.toLowerCase())

/** 按标的生成 SEO 元数据：标题带股票名（上游失败退回代码）；非法标的提前 404 */
export async function generateMetadata({ params }: SymbolPageProps): Promise<Metadata> {
  const { symbol: raw } = await params
  const parsed = parseOrNotFound(raw)
  if (parsed == null) {
    // 在流式响应冲刷前抛出，保证 HTTP 状态码为 404（页面内再抛已是 200）
    notFound()
  }
  let display = parsed.code
  try {
    const quote = await fetchQuote(parsed)
    if (quote.name != null) {
      display = `${quote.name}(${parsed.code})`
    }
  } catch {
    // 上游不可用时退回代码，不阻塞渲染
  }
  return {
    title: `${display} K线行情`,
    description: `${display} 实时K线行情：分时、1分至月线多周期K线，MA/MACD/KDJ 等技术指标与换手率、市盈率、市值等基本面数据。`,
    alternates: { canonical: `/${parsed.code}` },
    openGraph: { title: `${display} K线行情`, type: 'website' }
  }
}

export default async function SymbolPage({ params }: SymbolPageProps) {
  const { symbol: raw } = await params
  const parsed = parseOrNotFound(raw)
  if (parsed == null) {
    notFound()
  }
  // 服务端并行拉取首屏数据（带超时兜底）：信息表格直出真实行情，图表首屏免首次请求
  const { quote, initialBars } = await fetchInitialTerminalData(parsed)
  return (
    <TradingTerminal market={parsed.market} ticker={parsed.ticker} initialQuote={quote} initialBars={initialBars} />
  )
}
