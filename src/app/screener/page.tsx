import type { Metadata } from 'next'
import ScreenCenter from '@/components/screener/ScreenCenter'
import { getBoard } from '@/lib/server/market-db/board'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '选股中心',
  description: '领涨看板(本地快照库)：概念板块热力图与趋势达标领涨股筛选。'
}

/** 选股中心：SSR 初载领涨看板（market.db 只读快照，5min 缓存；缺库时客户端引导刷新） */
export default async function ScreenerPage() {
  const board = await getBoard()
  return <ScreenCenter initialBoard={board} />
}
