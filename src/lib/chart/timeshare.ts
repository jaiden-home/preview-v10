import type { AxisRange, KLineData } from 'klinecharts'

// ==================== 分时状态（模块级，图表控制器独占写） ====================

export interface TimeShareDatum {
  avg: number
}

export interface TimeShareState {
  active: boolean
  prevClose: number
  dayKey: string | null
  /** 每手股数：主板/创业板/北交所 100，科创板 200 */
  lotSize: number
  /** 当前标的为市场指数：均价线改用按量加权的指数点位均值 */
  isIndex: boolean
}

export const timeShareState: TimeShareState = {
  active: false,
  prevClose: Number.NaN,
  dayKey: null,
  lotSize: 100,
  isIndex: false
}

export const resetTimeShareState = (): void => {
  timeShareState.active = false
  timeShareState.dayKey = null
  timeShareState.prevClose = Number.NaN
  timeShareState.lotSize = 100
  timeShareState.isIndex = false
}

// ==================== 分时解析（协议解析在 server/provider/<id>/parse.ts） ====================

/**
 * 均价线：个股用官方累计成交额 / 累计成交量（手转股乘 lotSize），缺额时退回 close*volume 近似；
 * 指数无每股价格语义（额/量约为全市场平均股价，与点位差两个数量级），
 * 改用按量加权的指数点位均值，保证黄线贴合白线
 */
export const calcTimeShareAvg = (dataList: KLineData[]): TimeShareDatum[] => {
  if (timeShareState.isIndex) {
    let pvSum = 0
    let volSum = 0
    return dataList.map((bar) => {
      const volume = bar.volume ?? 0
      pvSum += bar.close * volume
      volSum += volume
      return { avg: volSum > 0 ? pvSum / volSum : bar.close }
    })
  }
  const lotSize = timeShareState.lotSize
  let amountSum = 0
  let volumeSum = 0
  return dataList.map((bar) => {
    const volume = bar.volume ?? 0
    amountSum += bar.turnover ?? bar.close * volume * lotSize
    volumeSum += volume
    return { avg: volumeSum > 0 ? amountSum / (volumeSum * lotSize) : bar.close }
  })
}

/** 以昨收为中心的对称区间，保证基准线位于面板中线 */
export const symmetricRangeAround = (base: number, defaultRange: AxisRange): AxisRange => {
  if (!Number.isFinite(base) || base <= 0) {
    return defaultRange
  }
  const half = Math.max(Math.abs(defaultRange.from - base), Math.abs(defaultRange.to - base))
  const safeHalf = half > 0 ? half : base * 0.01
  return {
    from: base - safeHalf,
    to: base + safeHalf,
    range: safeHalf * 2,
    realFrom: base - safeHalf,
    realTo: base + safeHalf,
    realRange: safeHalf * 2,
    displayFrom: base - safeHalf,
    displayTo: base + safeHalf,
    displayRange: safeHalf * 2
  }
}

// ==================== 百分比左轴换算 ====================

export const percentOfPrevClose = (value: number): number => {
  const prevClose = timeShareState.prevClose
  return Number.isFinite(prevClose) && prevClose > 0 ? (value / prevClose - 1) * 100 : value
}

export const priceOfPercent = (value: number): number => {
  const prevClose = timeShareState.prevClose
  return Number.isFinite(prevClose) && prevClose > 0 ? (value / 100 + 1) * prevClose : value
}

// ==================== 分时 x 轴锚点 ====================

/** 分时 x 轴锚点：符合 A 股交易时段，午休处合并显示 */
export interface TimeShareAnchor {
  hhmm: string
  text: string
  mergeNoon?: boolean
}

export const TIME_SHARE_X_ANCHORS: TimeShareAnchor[] = [
  { hhmm: '0930', text: '09:30' },
  { hhmm: '1030', text: '10:30' },
  { hhmm: '1130', text: '11:30/13:00', mergeNoon: true },
  { hhmm: '1400', text: '14:00' },
  { hhmm: '1500', text: '15:00' }
]

/**
 * 锚点在全天 242 根分时 bar 中的固定下标（午休不占 bar）：
 * 0930→0、1130→120、1300→121、1500→241。
 * 未到时段的锚点也按此下标渲染在右侧留白，保证位置全天恒定；
 * 勿改用 timestamp 让库换算，分钟周期会把 90 分钟午休外推成 90 根 bar
 */
export const timeShareAnchorIndex = (hhmm: string): number => {
  const minutes = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4))
  const open = 9 * 60 + 30
  const morningEnd = 11 * 60 + 30
  const afternoonOpen = 13 * 60
  return minutes <= morningEnd ? minutes - open : morningEnd - open + 1 + (minutes - afternoonOpen)
}
