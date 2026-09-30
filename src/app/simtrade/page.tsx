import type { Metadata } from 'next'
import SimTrading from '@/components/trading/SimTrading'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '极速模拟',
  description: '极速模拟交易（Sim Trading）：历史 K 线回放，10 秒一个交易日，T+1、涨跌停与费用仿真。'
}

/** 极速模拟页（/simtrade）：历史行情回放的加速模拟交易（虚拟时钟 + 日原子推进） */
export default function SimTradePage() {
  return <SimTrading />
}
