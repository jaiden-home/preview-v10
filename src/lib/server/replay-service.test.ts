import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { mergeAndTrimBars } from './replay-service'

const bar = (timestamp: number, close = timestamp): KLineData => ({
  timestamp,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1
})

describe('mergeAndTrimBars（多页去重合并裁剪）', () => {
  it('跨页按时间戳去重并升序排列', () => {
    const page1 = [bar(1), bar(2), bar(3)]
    const page2 = [bar(3), bar(4), bar(5)] // 与 page1 尾部重叠
    const merged = mergeAndTrimBars([page2, page1], 10)
    expect(merged.map((b) => b.timestamp)).toEqual([1, 2, 3, 4, 5])
  })

  it('超出目标根数时取末尾（保留最近历史）', () => {
    const merged = mergeAndTrimBars([[bar(1), bar(2), bar(3), bar(4)]], 2)
    expect(merged.map((b) => b.timestamp)).toEqual([3, 4])
  })

  it('空页与空入参返回空数组', () => {
    expect(mergeAndTrimBars([], 10)).toEqual([])
    expect(mergeAndTrimBars([[]], 10)).toEqual([])
  })
})
