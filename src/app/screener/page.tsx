import type { Metadata } from 'next'
import Screener from '@/components/screener/Screener'

export const metadata: Metadata = {
  title: '量化选股',
  description:
    '自定义量化条件的选股器(Stock screener)：技术指标（均线/RSI/MACD/量能/波动率）与基本面（PE/PB/市值/换手）条件组合，沪深主板全池分片筛选。'
}

/** 量化选股页：纯客户端运行（策略本地持久化，筛选经 /api/screener 分片渐进计算） */
export default function ScreenerPage() {
  return <Screener />
}
