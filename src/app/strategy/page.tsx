import type { Metadata } from 'next'
import StrategyCenter from '@/components/strategy/StrategyCenter'
import { getStrategyBundle } from '@/lib/server/market-db/strategy'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '策略模拟',
  description: 'A‴ 策略模拟交易（market.db 只读快照）：日榜走查 + 周榜三周连升 + B 点选股，保本止损/3% 止盈。'
}

/** 策略模拟：SSR 初载全版本数据束（版本化条件参数，末位注册 = 当前执行；无截止日随数据自动延伸，5min 缓存） */
export default async function StrategyPage() {
  const bundle = await getStrategyBundle()
  return <StrategyCenter initialBundle={bundle} />
}
