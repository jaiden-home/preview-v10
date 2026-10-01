import type { KLineData } from 'klinecharts'
import { CN_DOWN_COLOR, CN_FLAT_COLOR, CN_UP_COLOR } from './constants'

/**
 * 亚像素影线补画长度（CSS px）。
 * klinecharts 蜡烛 = 1px 宽 high→low 竖线 + 自带 1px 边框的实体矩形，
 * 影线露出实体的部分不足 1px 时会被实体边框完全盖住；
 * 从实体边缘向外补 2px 才能净露出 ≥1px（库边框吃掉约 1px）。
 */
export const MIN_SHADOW_PX = 2

/** 补画矩形：与库影线同为 1px 宽竖线，从实体边缘向影线方向延伸 */
export interface ShadowStubRect {
  x: number
  y: number
  width: number
  height: number
  color: string
}

/**
 * 计算单根 K 线的亚像素影线补画段：
 * 真实影线像素长度落在 (0, minPx) 时从实体边缘向外补画 minPx，否则交给库原生绘制。
 * 阴阳线着色与库 compareRule 'current_open'（close vs open）一致，平盘用 CN_FLAT_COLOR。
 *
 * @param toPixelY 价格 → 主图 y 像素（yAxis.convertToPixel）
 * @param x 该 K 线的柱中心 x 像素
 */
export const shadowStubRects = (
  bar: Pick<KLineData, 'open' | 'high' | 'low' | 'close'>,
  toPixelY: (price: number) => number,
  x: number,
  minPx: number = MIN_SHADOW_PX
): ShadowStubRect[] => {
  const bodyTopPrice = Math.max(bar.open, bar.close)
  const bodyBottomPrice = Math.min(bar.open, bar.close)
  const bodyTopY = toPixelY(bodyTopPrice)
  const bodyBottomY = toPixelY(bodyBottomPrice)
  const color = bar.close > bar.open ? CN_UP_COLOR : bar.close < bar.open ? CN_DOWN_COLOR : CN_FLAT_COLOR

  const rects: ShadowStubRect[] = []
  if (bar.high > bodyTopPrice && bodyTopY - toPixelY(bar.high) < minPx) {
    rects.push({ x, y: bodyTopY - minPx, width: 1, height: minPx, color })
  }
  if (bar.low < bodyBottomPrice && toPixelY(bar.low) - bodyBottomY < minPx) {
    rects.push({ x, y: bodyBottomY, width: 1, height: minPx, color })
  }
  return rects
}
