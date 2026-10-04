import { describe, expect, it } from 'vitest'
import { CN_UP_COLOR } from './constants'
import {
  SIGNAL_BADGE_GAP,
  SIGNAL_BADGE_RADIUS,
  SIGNAL_SELL_COLOR_DARK,
  SIGNAL_SELL_COLOR_LIGHT,
  resetSimSignalState,
  signalColorOf,
  signalMarkerOf,
  simSignalState
} from './sim-signal'

/** 线性价格→像素映射：每 1 元 = pxPerUnit 像素（y 随价格升高而减小） */
const pixelOf = (pxPerUnit: number) => (price: number) => 200 - price * pxPerUnit

const bar = { open: 10, high: 10.5, low: 9.6, close: 10.2 }

describe('signalMarkerOf', () => {
  it('买入徽记位于低点下方 gap + radius 处，文字 B', () => {
    const m = signalMarkerOf(bar, 'buy', pixelOf(10), 50)
    expect(m).toEqual({
      x: 50,
      y: pixelOf(10)(bar.low) + SIGNAL_BADGE_GAP + SIGNAL_BADGE_RADIUS,
      r: SIGNAL_BADGE_RADIUS,
      text: 'B',
      side: 'buy'
    })
  })

  it('卖出徽记位于高点上方 gap + radius 处，文字 S', () => {
    const m = signalMarkerOf(bar, 'sell', pixelOf(10), 50)
    expect(m).toEqual({
      x: 50,
      y: pixelOf(10)(bar.high) - SIGNAL_BADGE_GAP - SIGNAL_BADGE_RADIUS,
      r: SIGNAL_BADGE_RADIUS,
      text: 'S',
      side: 'sell'
    })
  })

  it('opts 可覆写半径与间距', () => {
    const m = signalMarkerOf(bar, 'buy', pixelOf(10), 50, { radius: 5, gap: 2 })
    expect(m.r).toBe(5)
    expect(m.y).toBe(pixelOf(10)(bar.low) + 7)
  })
})

describe('signalColorOf', () => {
  it('买入恒为 A 股红（--up，深浅共用）', () => {
    expect(signalColorOf('buy', false)).toBe(CN_UP_COLOR)
    expect(signalColorOf('buy', true)).toBe(CN_UP_COLOR)
  })

  it('卖出为品牌蓝 --tb-active（浅/深双值）', () => {
    expect(signalColorOf('sell', false)).toBe(SIGNAL_SELL_COLOR_LIGHT)
    expect(signalColorOf('sell', true)).toBe(SIGNAL_SELL_COLOR_DARK)
  })
})

describe('simSignalState', () => {
  it('resetSimSignalState 清空信号点并还原浅色主题', () => {
    simSignalState.points.set(1, 'buy')
    simSignalState.dark = true
    resetSimSignalState()
    expect(simSignalState.points.size).toBe(0)
    expect(simSignalState.dark).toBe(false)
  })
})
