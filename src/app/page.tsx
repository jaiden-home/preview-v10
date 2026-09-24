import type { Metadata } from 'next'
import HomeLanding from '@/components/home/HomeLanding'

export const metadata: Metadata = {
  title: '首页',
  description: 'A 股行情预览与模拟交易 Web 终端入口：行情看板（K 线 / 分时 / 指标）与模拟交易（Paper Trading）。'
}

/** 首页：仅承载两个功能页入口（行情看板 / 模拟交易），终端内容已迁移至 /dashboard */
export default function HomePage() {
  return <HomeLanding />
}
