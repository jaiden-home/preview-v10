import type { DeepPartial, Period, Styles } from 'klinecharts'
import type { SymbolSearchItem } from './types'

export const BAR_LIMIT = 500

/** 行情轮询间隔（ms），与原 SPA 保持一致 */
export const POLL_INTERVAL_MS = 3000

export const TIMESPAN_MILLIS: Record<Period['type'], number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000
}

// ==================== 周期 ====================

export interface PeriodOption {
  key: string
  span: number
  type: Period['type']
  text: string
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { key: '1m', span: 1, type: 'minute', text: '1分|1m' },
  { key: '5m', span: 5, type: 'minute', text: '5分|5m' },
  { key: '15m', span: 15, type: 'minute', text: '15分|15m' },
  { key: '30m', span: 30, type: 'minute', text: '30分|30m' },
  { key: '1h', span: 1, type: 'hour', text: '1时|1h' },
  { key: '4h', span: 4, type: 'hour', text: '4时|4h' },
  { key: '1d', span: 1, type: 'day', text: '日|1D' },
  { key: '1w', span: 1, type: 'week', text: '周|1W' },
  { key: '1M', span: 1, type: 'month', text: '月|1M' }
]

/** 周期键：'time' 为分时，其余与 PERIOD_OPTIONS 对应 */
export type PeriodKey = (typeof PERIOD_OPTIONS)[number]['key'] | 'time'

export const DEFAULT_PERIOD_KEY: PeriodKey = '1d'

export const findPeriodOption = (key: PeriodKey) => PERIOD_OPTIONS.find((o) => o.key === key)

const PERIOD_KEY_PREFIX: Record<Period['type'], string> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  week: 'w',
  month: 'M',
  year: 'y'
}

export const cnPeriodKey = (period: Period): string => `${period.span}${PERIOD_KEY_PREFIX[period.type]}`

// ==================== 指标与绘图 ====================

export const MAIN_INDICATORS = ['MA', 'EMA', 'SMA', 'BOLL', 'SAR', 'BBI']

export const SUB_INDICATORS = [
  'VOL',
  'MACD',
  'KDJ',
  'RSI',
  'BIAS',
  'CCI',
  'WR',
  'DMI',
  'OBV',
  'PSY',
  'DMA',
  'EMV',
  'ROC',
  'TRIX',
  'VR',
  'MTM',
  'TURNOVER',
  'AMPLITUDE'
]

export interface DrawingTool {
  name: string
  text: string
}

export const DRAWING_TOOLS: DrawingTool[] = [
  { name: 'straightLine', text: '直线|Line' },
  { name: 'segment', text: '线段|Segment' },
  { name: 'rayLine', text: '射线|Ray' },
  { name: 'horizontalStraightLine', text: '水平线|Horizontal Line' },
  { name: 'verticalStraightLine', text: '垂直线|Vertical Line' },
  { name: 'priceLine', text: '价格线|Price Line' },
  { name: 'priceChannelLine', text: '价格通道线|Price Channel' },
  { name: 'parallelStraightLine', text: '平行直线|Parallel Line' },
  { name: 'fibonacciLine', text: '斐波那契回调线|Fibonacci' },
  { name: 'brush', text: '画笔|Brush' },
  { name: 'simpleAnnotation', text: '注释|Annotation' }
]

export interface IndicatorParamMeta {
  label: string
  min: number
  decimal?: boolean
}

export const INDICATOR_PARAM_META: Record<string, IndicatorParamMeta[]> = {
  MA: [
    { label: 'MA1', min: 1 },
    { label: 'MA2', min: 1 },
    { label: 'MA3', min: 1 },
    { label: 'MA4', min: 1 },
    { label: 'MA5', min: 1 }
  ],
  EMA: [
    { label: 'EMA1', min: 1 },
    { label: 'EMA2', min: 1 },
    { label: 'EMA3', min: 1 },
    { label: 'EMA4', min: 1 },
    { label: 'EMA5', min: 1 }
  ],
  SMA: [
    { label: '周期|Period', min: 1 },
    { label: '权重|Weight', min: 1 }
  ],
  BOLL: [
    { label: '周期|Period', min: 1 },
    { label: '标准差|Std Dev', min: 0.1, decimal: true }
  ],
  SAR: [
    { label: '步长|Step', min: 0.01, decimal: true },
    { label: '加速因子|Factor', min: 0.01, decimal: true },
    { label: '极值|Max', min: 1 }
  ],
  BBI: [
    { label: '参数 1|Param 1', min: 1 },
    { label: '参数 2|Param 2', min: 1 },
    { label: '参数 3|Param 3', min: 1 },
    { label: '参数 4|Param 4', min: 1 }
  ],
  VOL: [
    { label: 'MA1', min: 1 },
    { label: 'MA2', min: 1 },
    { label: 'MA3', min: 1 },
    { label: 'MA4', min: 1 },
    { label: 'MA5', min: 1 }
  ],
  MACD: [
    { label: '快线|Fast', min: 1 },
    { label: '慢线|Slow', min: 1 },
    { label: '信号|Signal', min: 1 }
  ],
  KDJ: [
    { label: '周期|Period', min: 1 },
    { label: 'K', min: 1 },
    { label: 'D', min: 1 }
  ],
  RSI: [
    { label: 'RSI1', min: 1 },
    { label: 'RSI2', min: 1 },
    { label: 'RSI3', min: 1 },
    { label: 'RSI4', min: 1 },
    { label: 'RSI5', min: 1 }
  ],
  BIAS: [
    { label: 'BIAS1', min: 1 },
    { label: 'BIAS2', min: 1 },
    { label: 'BIAS3', min: 1 },
    { label: 'BIAS4', min: 1 },
    { label: 'BIAS5', min: 1 }
  ],
  CCI: [{ label: '周期|Period', min: 1 }],
  WR: [
    { label: 'WR1', min: 1 },
    { label: 'WR2', min: 1 },
    { label: 'WR3', min: 1 },
    { label: 'WR4', min: 1 },
    { label: 'WR5', min: 1 }
  ],
  DMI: [
    { label: '周期|Period', min: 1 },
    { label: '平滑|Smooth', min: 1 }
  ],
  OBV: [{ label: '周期|Period', min: 1 }],
  PSY: [
    { label: '周期|Period', min: 1 },
    { label: 'MA|MA', min: 1 }
  ],
  DMA: [
    { label: '快线|Fast', min: 1 },
    { label: '慢线|Slow', min: 1 },
    { label: 'MA|MA', min: 1 }
  ],
  EMV: [
    { label: '周期|Period', min: 1 },
    { label: 'MA|MA', min: 1 }
  ],
  ROC: [
    { label: '周期|Period', min: 1 },
    { label: 'MA|MA', min: 1 }
  ],
  TRIX: [
    { label: '周期|Period', min: 1 },
    { label: 'MA|MA', min: 1 }
  ],
  VR: [
    { label: '周期|Period', min: 1 },
    { label: 'MA|MA', min: 1 }
  ],
  MTM: [
    { label: '周期|Period', min: 1 },
    { label: 'MA|MA', min: 1 }
  ]
}

// ==================== 默认标的 ====================

export const DEFAULT_SYMBOLS: SymbolSearchItem[] = [
  { ticker: '000001', name: '上证指数', market: 'sh' },
  { ticker: '399001', name: '深证成指', market: 'sz' },
  { ticker: '399006', name: '创业板指', market: 'sz' },
  { ticker: '000300', name: '沪深300', market: 'sh' },
  { ticker: '000688', name: '科创50', market: 'sh' },
  { ticker: '000905', name: '中证500', market: 'sh' }
]

export const DEFAULT_SYMBOL_CODE = 'sh000001'

// ==================== A 股配色 ====================

/** A 股红涨 */
export const CN_UP_COLOR = '#ef2323'
/** A 股绿跌 */
export const CN_DOWN_COLOR = '#14a143'
/** 平盘 */
export const CN_FLAT_COLOR = '#8ca0b3'

// ==================== 分时 ====================

/** 分时百分比左轴注册名 */
export const PERCENT_Y_AXIS_NAME = 'cnTimePercent'

/** A 股一个交易日的分时分钟数：09:30-11:30 与 13:00-15:00 各 121 根 */
export const TIME_SHARE_TOTAL_BARS = 242

/** 分时上下留白对称，保证昨收基准线严格居中（默认 gap 上 0.2 / 下 0.1 不对称） */
export const TIME_SHARE_AXIS_GAP = { top: 0.08, bottom: 0.08 }
export const DEFAULT_AXIS_GAP = { top: 0.2, bottom: 0.1 }

// ==================== 移动端紧凑价格轴 ====================

/** 移动端视口断点（px），与 globals.css `@media (max-width: 768px)` 一致 */
export const MOBILE_VIEWPORT_MAX = 768

/**
 * 移动端紧凑价格轴：klinecharts 右轴 auto 宽 = 轴线 + 刻度线 + 刻度文本（含边距），
 * 且不小于最新价标签与十字光标横标签的宽度——三者须同步压缩，刻度区才能整体收窄，
 * 让位给 K 线主体。
 */
export const COMPACT_AXIS_STYLES: DeepPartial<Styles> = {
  yAxis: {
    tickText: { size: 9, marginStart: 2, marginEnd: 2 },
    tickLine: { show: false }
  },
  candle: {
    priceMark: {
      last: { text: { size: 9, paddingLeft: 2, paddingRight: 2 } }
    }
  },
  crosshair: {
    horizontal: { text: { size: 9, paddingLeft: 2, paddingRight: 2 } }
  }
}

/** 退出移动端视口后还原 klinecharts 默认轴样式（值与库默认一致） */
export const COMPACT_AXIS_STYLES_RESTORE: DeepPartial<Styles> = {
  yAxis: {
    tickText: { size: 12, marginStart: 4, marginEnd: 6 },
    tickLine: { show: true }
  },
  candle: {
    priceMark: {
      last: { text: { size: 12, paddingLeft: 4, paddingRight: 4 } }
    }
  },
  crosshair: {
    horizontal: { text: { size: 12, paddingLeft: 4, paddingRight: 4 } }
  }
}
