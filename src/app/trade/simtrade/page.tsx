import type { Metadata } from 'next'
import SimTrading from '@/components/trading/SimTrading'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '极速模拟',
  description: '极速模拟交易（Sim Trading）：历史 K 线回放，15/30/60 秒一个交易日，T+1、涨跌停与费用仿真。'
}

/** 极速模拟页（/trade/simtrade）：模拟交易页的 1:1 复制基线，后续演进为历史行情回放加速模拟 */
export default function SimTradePage() {
  return <SimTrading />
}
