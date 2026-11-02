import type { Metadata } from 'next'
import StrategyCenter from '@/components/strategy/StrategyCenter'
import { getStrategy } from '@/lib/server/market-db/strategy'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '策略模拟',
  description: 'A‴ 策略模拟交易（market.db 只读快照）：日榜走查 + 周榜三周连升 + B 点选股，保本止损/3% 止盈。'
}

/** 策略模拟：SSR 初载策略全量数据（起始日 2026-11-02、无截止日随数据自动延伸，5min 缓存；缺库时客户端引导刷新） */
export default async function StrategyPage() {
  const data = await getStrategy()
  return <StrategyCenter initialData={data} />
}
