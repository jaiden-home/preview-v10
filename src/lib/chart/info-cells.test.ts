import { beforeEach, describe, expect, it } from 'vitest'
import { buildInfoCells } from './info-cells'
import { timeShareState } from './timeshare'
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
  beforeEach(() => {
    timeShareState.active = false
    timeShareState.prevClose = Number.NaN
    timeShareState.dayOpen = Number.NaN
    timeShareState.dayHigh = Number.NaN
    timeShareState.dayLow = Number.NaN
  })

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
    expect(labels.slice(0, 8)).toEqual(['时间', '今收', '今开', '最高', '最低', '均价', '涨跌', '振幅'])
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

  it('分时模式涨跌以全天昨收为基准，而非上一分钟价格', () => {
    timeShareState.active = true
    timeShareState.prevClose = 10
    // 分时 bar：开=前一分钟价，高=低=收=当分钟价（parseTimeShareDay 产物）
    const minuteBar = (timestamp: number, price: number, prevPrice: number) => ({
      timestamp,
      open: prevPrice,
      close: price,
      high: price,
      low: price,
      volume: 100
    })
    const t1 = new Date('2026-09-14T09:31').getTime()
    const t2 = new Date('2026-09-14T09:32').getTime()
    const cells = buildInfoCells(
      {
        dataList: [minuteBar(t1, 10.02, 10), minuteBar(t2, 10.01, 10.02)],
        hovered: null,
        fundamental,
        intraday: true
      },
      'zh-CN'
    )!
    // 10.01 - 昨收 10 = +0.01（修复前误为 10.01 - 10.02 = -0.01）
    expect(cells[6].value).toBe('+0.01 (+0.10%)')
    expect(cells[6].color).toBe('#ef2323')
  })

  it('分时模式今开取首分钟价，最高/最低为累计极值，悬停振幅按累计口径', () => {
    timeShareState.active = true
    timeShareState.prevClose = 10
    const minuteBar = (timestamp: number, price: number, prevPrice: number) => ({
      timestamp,
      open: prevPrice,
      close: price,
      high: price,
      low: price,
      volume: 100
    })
    const t = (m: number) => new Date(`2026-09-14T09:3${m}`).getTime()
    const bars = [
      minuteBar(t(0), 10.0, 10),
      minuteBar(t(1), 10.2, 10.0),
      minuteBar(t(2), 10.1, 10.2),
      minuteBar(t(3), 9.95, 10.1)
    ]
    // 未悬停：截至最新一根的当日口径
    const cells = buildInfoCells({ dataList: bars, hovered: null, fundamental, intraday: true }, 'zh-CN')!
    // 今开 = 首分钟成交价（修复前误为上一分钟价格）
    expect(cells[2].value).toBe('10.00')
    // 最高/最低 = 累计极值（修复前误为末分钟价 9.95）
    expect(cells[3].value).toBe('10.20')
    expect(cells[4].value).toBe('9.95')
    // 悬停第 3 根（10.1）：极值截至该分钟，振幅 = (10.20-10.00)/昨收 10 = 2.00%
    const hovered = buildInfoCells({ dataList: bars, hovered: bars[2], fundamental, intraday: true }, 'zh-CN')!
    expect(hovered[3].value).toBe('10.20')
    expect(hovered[4].value).toBe('10.00')
    // 修复前分时 high==low，悬停振幅恒 0.00%
    expect(hovered[7].value).toBe('2.00%')
  })

  it('分时模式优先显示官方日开/高/低（分钟快照取不到盘中瞬时极值）', () => {
    timeShareState.active = true
    timeShareState.prevClose = 10
    timeShareState.dayOpen = 10.01
    timeShareState.dayHigh = 10.3
    timeShareState.dayLow = 9.9
    const minuteBar = (timestamp: number, price: number, prevPrice: number) => ({
      timestamp,
      open: prevPrice,
      close: price,
      high: price,
      low: price,
      volume: 100
    })
    const t = (m: number) => new Date(`2026-09-14T09:3${m}`).getTime()
    // 分钟累计极值 10.2/10.0，均窄于官方日高/低
    const bars = [
      minuteBar(t(0), 10.0, 10),
      minuteBar(t(1), 10.2, 10.0),
      minuteBar(t(2), 10.1, 10.2),
      minuteBar(t(3), 9.95, 10.1)
    ]
    const cells = buildInfoCells({ dataList: bars, hovered: null, fundamental, intraday: true }, 'zh-CN')!
    expect(cells[2].value).toBe('10.01')
    expect(cells[3].value).toBe('10.30')
    expect(cells[4].value).toBe('9.90')
    // 悬停历史分钟同样显示官方日值，悬停振幅按官方口径 (10.30-9.90)/10 = 4.00%
    const hovered = buildInfoCells({ dataList: bars, hovered: bars[1], fundamental, intraday: true }, 'zh-CN')!
    expect(hovered[3].value).toBe('10.30')
    expect(hovered[4].value).toBe('9.90')
    expect(hovered[7].value).toBe('4.00%')
  })
})
