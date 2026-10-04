import type { KLineData } from 'klinecharts'
import type { TradeSignal } from '../trading/signal'
import { CN_UP_COLOR } from './constants'

// ==================== 极速模拟买卖点标记（模块级，图表控制器独占写） ====================
// 信号点由 /simtrade 页按虚拟日推进求值后经 ChartTerminal.setSimSignals 注入（本地单一用户），
// SIM_SIGNAL 指标（registers.ts）在日周期 K 线柱下方（买）/上方（卖）绘制 B/S 徽记。

/** 徽记半径（CSS px） */
export const SIGNAL_BADGE_RADIUS = 7
/** 徽记与 K 线柱（低点/高点）的间距（CSS px） */
export const SIGNAL_BADGE_GAP = 4
/** 徽记字号/字族（画布常量，图表域不引用 CSS 令牌） */
export const SIGNAL_BADGE_FONT = '700 9px sans-serif'
/** 徽记文字色 = `--on-solid`（实底白字，深浅共用） */
export const SIGNAL_TEXT_COLOR = '#ffffff'
/** 卖出徽记底色 = `--tb-active`（浅色） */
export const SIGNAL_SELL_COLOR_LIGHT = '#1677ff'
/** 卖出徽记底色 = `--tb-active`（深色） */
export const SIGNAL_SELL_COLOR_DARK = '#3c82f7'

/** 徽记底色：买入 = `--up` 红（深浅共用），卖出 = `--tb-active` 蓝（随主题） */
export const signalColorOf = (side: TradeSignal, dark: boolean): string =>
  side === 'buy' ? CN_UP_COLOR : dark ? SIGNAL_SELL_COLOR_DARK : SIGNAL_SELL_COLOR_LIGHT

/** 徽记绘制参数（draw 侧按 x/y/r/text 落笔，颜色由 signalColorOf 按主题解析） */
export interface SignalMarker {
  x: number
  y: number
  r: number
  text: string
  side: TradeSignal
}

/**
 * 单根 K 线的买卖点徽记几何：
 * 买（B）= 低点下方 gap+r 处；卖（S）= 高点上方 gap+r 处
 * （y 轴默认留白 top 0.2 / bottom 0.1 保证极值柱外有空间，不越界）。
 *
 * @param toPixelY 价格 → 主图 y 像素（yAxis.convertToPixel）
 * @param x 该 K 线的柱中心 x 像素
 */
export const signalMarkerOf = (
  bar: Pick<KLineData, 'high' | 'low'>,
  side: TradeSignal,
  toPixelY: (price: number) => number,
  x: number,
  opts: { radius?: number; gap?: number } = {}
): SignalMarker => {
  const r = opts.radius ?? SIGNAL_BADGE_RADIUS
  const gap = opts.gap ?? SIGNAL_BADGE_GAP
  return side === 'buy'
    ? { x, y: toPixelY(bar.low) + gap + r, r, text: 'B', side }
    : { x, y: toPixelY(bar.high) - gap - r, r, text: 'S', side }
}

export interface SimSignalState {
  /** 信号日 bar 时间戳 → 方向（空 = 无标记） */
  points: Map<number, TradeSignal>
  /** 深色主题（卖出徽记底色随主题取 --tb-active 双值） */
  dark: boolean
}

export const simSignalState: SimSignalState = {
  points: new Map(),
  dark: false
}

export const resetSimSignalState = (): void => {
  simSignalState.points = new Map()
  simSignalState.dark = false
}
