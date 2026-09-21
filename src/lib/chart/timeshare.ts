import type { AxisRange, KLineData } from 'klinecharts'
import { parseCnBarTime } from './utils'

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

// ==================== 分时解析 ====================

const isTradingMinute = (hhmm: string): boolean =>
  (hhmm >= '0930' && hhmm <= '1130') || (hhmm >= '1300' && hhmm <= '1500')

/**
 * 官方分时点 "0930 1277.27 133 16987691.06" = 时间 价格 累计量 累计额(元)
 * 主板/创业板/北交 quantity 单位为手，科创板为股（北交所无累计额列）
 * 差分出每分钟量（统一转手）/额；open 取前一分钟价格（首根用 basePrice），供成交量按分钟涨跌着色
 */
export const parseTimeShareDay = (
  date: string,
  points: unknown[],
  basePrice: number,
  sharesPerLot = 1
): KLineData[] => {
  if (!/^\d{8}$/.test(date)) {
    return []
  }
  const bars: KLineData[] = []
  let prevCumVolume = 0
  let prevCumAmount = 0
  let prevPrice = basePrice
  for (const point of points) {
    if (typeof point !== 'string') {
      continue
    }
    const [hhmm, priceText, cumVolumeText, cumAmountText] = point.trim().split(/\s+/)
    if (!/^\d{4}$/.test(hhmm ?? '') || !isTradingMinute(hhmm)) {
      continue
    }
    const timestamp = parseCnBarTime(`${date}${hhmm}`)
    const price = Number(priceText)
    const cumVolume = Number(cumVolumeText)
    const cumAmount = Number(cumAmountText)
    if (!Number.isFinite(timestamp) || !Number.isFinite(price) || price <= 0) {
      continue
    }
    // 原始量统一换算为手（科创板除以 200，其余板块本身即手）
    const volume = Number.isFinite(cumVolume) ? Math.max(0, Math.round((cumVolume - prevCumVolume) / sharesPerLot)) : 0
    // 累计额缺失（北交所）时留空，由均价计算回退近似
    const turnover = Number.isFinite(cumAmount) ? Math.max(0, cumAmount - prevCumAmount) : undefined
    if (Number.isFinite(cumVolume)) {
      prevCumVolume = cumVolume
    }
    if (Number.isFinite(cumAmount)) {
      prevCumAmount = cumAmount
    }
    bars.push({
      timestamp,
      open: Number.isFinite(prevPrice) && prevPrice > 0 ? prevPrice : price,
      high: price,
      low: price,
      close: price,
      volume,
      turnover
    })
    prevPrice = price
  }
  return bars
}

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
