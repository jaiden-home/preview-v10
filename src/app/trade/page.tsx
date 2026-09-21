import type { Metadata } from 'next'
import PaperTrading from '@/components/trading/PaperTrading'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '模拟交易',
  description: 'A 股模拟交易（Paper Trading）：虚拟资金、整手买入、T+1 卖出、涨跌停与费用仿真，行情实时联动。'
}

/** 模拟交易页：客户端虚拟账户 + BFF 行情轮询 */
export default function TradePage() {
  return <PaperTrading />
}
