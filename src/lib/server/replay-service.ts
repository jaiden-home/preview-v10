import type { KLineData, Period } from 'klinecharts'
import type { SymbolRef } from '../chart/types'
import { fetchKLines } from './market-service'

// ==================== 回放数据编排（BFF） ====================
// 腾讯上游单次上限 640 根日 K：按页回溯拼接，供 /api/replay 一次性返回足量历史，
// 客户端（/simtrade）不再自行拉取与裁剪，且窗口不再受单页上限约束。
// 回溯到上市日/数据尽头即停（短页或上游不再前移），保证"有数据就任意可选"。

/** 每页目标根数（留余量低于上游 640 上限） */
const PAGE_BARS = 600
/** 每页回溯的自然日跨度（交易日 ≈ 自然日 × 0.66，含节假日余量） */
const PAGE_SPAN_DAYS = Math.ceil(PAGE_BARS * 1.6)
const DAY_MS = 86_400_000
/** 最大分页数（600 根/页 ≈ 7200 根 ≈ 30 年，覆盖全部 A 股历史；防上游异常空转） */
const MAX_PAGES = 12
/** 短页阈值：明显短于整页视为接近上市/数据尽头 */
const SHORT_PAGE = PAGE_BARS * 0.5

/** 多页去重合并并裁剪到目标根数（升序，取末尾）——纯函数，供测试 */
export const mergeAndTrimBars = (pages: KLineData[][], targetBars: number): KLineData[] => {
  const byTs = new Map<number, KLineData>()
  for (const bars of pages) {
    for (const bar of bars) {
      byTs.set(bar.timestamp, bar)
    }
  }
  return Array.from(byTs.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-targetBars)
}

/** 拉取某标的日 K（升序）：目标 targetBars 根，不足时按页回溯直至上市/数据尽头 */
export const fetchReplayBars = async (symbol: SymbolRef, targetBars: number): Promise<KLineData[]> => {
  const dayPeriod: Period = { span: 1, type: 'day' }
  const pages: KLineData[][] = []
  let total = 0
  let to = Date.now()
  let oldest = Number.POSITIVE_INFINITY
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const bars = await fetchKLines(symbol, dayPeriod, to - PAGE_SPAN_DAYS * DAY_MS, to)
    if (bars.length === 0) {
      break
    }
    pages.push(bars)
    total += bars.length
    if (total >= targetBars) {
      break
    }
    // 短页 = 接近上市/数据尽头；最早一根不再前移 = 上游无更早数据
    const pageOldest = bars[0]!.timestamp
    if (bars.length < SHORT_PAGE || pageOldest >= oldest) {
      break
    }
    oldest = pageOldest
    // 下一页从本页最早一根之前继续回溯
    to = pageOldest - 1
  }
  return mergeAndTrimBars(pages, targetBars)
}
