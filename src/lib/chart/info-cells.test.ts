import { describe, expect, it } from 'vitest'
import { buildInfoCells } from './info-cells'
import type { FundamentalData } from './types'

const bar = (timestamp: number, close: number, prevClose: number) => ({
  timestamp,
  open: prevClose,
  close,
  high: close + 1,
  low: close - 1,
  volume: 12345
})

const fundamental: FundamentalData = {
  turnoverRate: 1.23,
  amplitude: 2.34,
  pe: 30.5,
  peDynamic: 28.1,
  peStatic: 32.9,
  pb: 9.87,
  totalMarketCap: 2.1e12,
  floatMarketCap: 2.1e12,
  avgPrice: 1700.12
}

describe('信息表格数据', () => {
  it('空数据返回 null（渲染加载占位）', () => {
    expect(buildInfoCells({ dataList: [], hovered: null, fundamental: {}, intraday: false }, 'zh-CN')).toBeNull()
  })

  it('生成 16 个单元格：行情行随红涨绿跌着色，基本面行中性色', () => {
    const t1 = new Date('2026-09-11T00:00').getTime()
    const t2 = new Date('2026-09-14T00:00').getTime()
    const cells = buildInfoCells(
      { dataList: [bar(t1, 10, 10), bar(t2, 11, 10)], hovered: null, fundamental, intraday: false },
      'zh-CN'
    )!
    expect(cells).toHaveLength(16)
    const labels = cells.map((c) => c.label)
    expect(labels.slice(0, 8)).toEqual(['时间', '今价', '今开', '最高', '最低', '均价', '涨跌', '振幅'])
    expect(labels.slice(8)).toEqual(['换手率', '成交量', '总市值', '流通市值', '市盈', '市盈动', '市盈静', '市净率'])
    // 上涨：行情行红涨色，时间中性
    expect(cells[0].color).toBe('var(--tb-text)')
    expect(cells[1].color).toBe('#ef2323')
    expect(cells[6].value).toContain('+1.00')
    // 基本面行统一中性色
    expect(cells[8].color).toBe('var(--tb-text)')
    // 日线周期时间列不带时分
    expect(cells[0].value).toBe('2026-09-14')
  })

  it('分钟周期时间列显示到时分', () => {
    const ts = new Date('2026-09-14T14:45').getTime()
    const cells = buildInfoCells(
      { dataList: [bar(ts, 10, 10)], hovered: null, fundamental: {}, intraday: true },
      'zh-CN'
    )!
    expect(cells[0].value).toBe('2026-09-14 14:45')
  })

  it('悬停历史 K 线时切到对应数据', () => {
    const t1 = new Date('2026-09-11T00:00').getTime()
    const t2 = new Date('2026-09-14T00:00').getTime()
    const first = bar(t1, 10, 9)
    const cells = buildInfoCells(
      { dataList: [first, bar(t2, 11, 10)], hovered: first, fundamental, intraday: false },
      'zh-CN'
    )!
    expect(cells[0].value).toBe('2026-09-11')
    expect(cells[1].value).toBe('10.00')
  })
})
