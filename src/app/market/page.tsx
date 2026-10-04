import type { Metadata } from 'next'
import MarketCenter from '@/components/market/MarketCenter'
import type { MarketOverview } from '@/lib/chart/types'
import { fetchMarketOverview } from '@/lib/server/market-service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '行情中心',
  description: 'A 股行情总览(Market center)：指数概览、官方行业/概念板块榜单与领涨股、自选收藏，一键深链行情看板。'
}

/** 行情中心页：SSR 直供默认视图（行业涨幅榜），自选由客户端挂载后并入轮询 */
export default async function MarketPage() {
  let initial: MarketOverview | null = null
  try {
    initial = await fetchMarketOverview({ board: 'industry', sort: 'changePct', direction: 'desc', watches: [] })
  } catch {
    initial = null
  }
  return <MarketCenter initial={initial} />
}
