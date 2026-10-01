import { describe, expect, it } from 'vitest'
import { CN_DOWN_COLOR, CN_FLAT_COLOR, CN_UP_COLOR } from './constants'
import { MIN_SHADOW_PX, shadowStubRects } from './min-shadow'

/** 线性价格→像素映射：每 1 元 = pxPerUnit 像素（y 随价格升高而减小） */
const pixelOf = (pxPerUnit: number) => (price: number) => 200 - price * pxPerUnit

const bar = (open: number, high: number, low: number, close: number) => ({ open, high, low, close })

describe('shadowStubRects', () => {
  it('无影线（high 贴实体上沿 / low 贴实体下沿）不补画', () => {
    expect(shadowStubRects(bar(10.2, 10.2, 10, 10.2), pixelOf(10), 50)).toEqual([])
    expect(shadowStubRects(bar(10, 10, 10, 9.8), pixelOf(10), 50)).toEqual([])
  })

  it('影线像素长度足够时不补画（交给库原生绘制）', () => {
    // 上影 0.3 元 × 10px/元 = 3px、下影 0.4 元 = 4px，均 ≥ 2px
    expect(shadowStubRects(bar(10, 10.5, 9.6, 10.2), pixelOf(10), 50)).toEqual([])
  })

  it('上影线亚像素时从实体上沿向上补画 MIN_SHADOW_PX', () => {
    // 阳线：上影 0.01 元 × 10px/元 = 0.1px（无下影）
    const rects = shadowStubRects(bar(10, 10.21, 10, 10.2), pixelOf(10), 50)
    expect(rects).toHaveLength(1)
    expect(rects[0]).toEqual({
      x: 50,
      y: pixelOf(10)(10.2) - MIN_SHADOW_PX,
      width: 1,
      height: MIN_SHADOW_PX,
      color: CN_UP_COLOR
    })
  })

  it('下影线亚像素时从实体下沿向下补画，阴线用绿', () => {
    // 阴线：下影 0.02 元 × 10px/元 = 0.2px
    const rects = shadowStubRects(bar(10.2, 10.2, 9.98, 10), pixelOf(10), 50)
    expect(rects).toHaveLength(1)
    expect(rects[0]).toEqual({ x: 50, y: pixelOf(10)(10), width: 1, height: MIN_SHADOW_PX, color: CN_DOWN_COLOR })
  })

  it('上下影线均亚像素时补两段', () => {
    const rects = shadowStubRects(bar(10, 10.01, 9.99, 10.005), pixelOf(10), 50)
    expect(rects).toHaveLength(2)
  })

  it('平盘（close == open）十字星微影用平盘色', () => {
    const rects = shadowStubRects(bar(10, 10.01, 10, 10), pixelOf(10), 50)
    expect(rects).toHaveLength(1)
    expect(rects[0].color).toBe(CN_FLAT_COLOR)
  })
})
