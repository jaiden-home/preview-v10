import type { KLineData } from 'klinecharts'
import type { FundamentalData } from './chart/types'
import { timeShareState } from './chart/timeshare'
import type { Locale } from './i18n'

// ==================== 信息表格渲染数据 ====================

export interface FundamentalItem {
  label: string
  value: string
}

const fmt = (value: number | undefined, precision: number = 2, preferredUnit?: string): string => {
  if (value == null || !Number.isFinite(value)) return '--'

  if (preferredUnit === '亿') {
    if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(precision)}亿`
    if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(precision)}万`
    return value.toFixed(precision)
  }

  if (preferredUnit === '万') {
    if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(precision)}万`
    return value.toFixed(precision)
  }

  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(precision)}万亿`
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(precision)}亿`
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(precision)}万`
  return value.toFixed(precision)
}

/**
 * 生成基本面指标（键控结构，供信息表格与 K 线行情混排）。
 * 未悬停（含最后一根）显示接口原值；悬停历史 K 线时：
 * - 振幅/换手率：由 K 线精确重算
 * - 市盈/市净/市值/均价：按 收盘价比例 回溯（假设股本与财务数据不变，近似值）
 */
export const buildFundamentalItems = (
  data: FundamentalData,
  locale: Locale,
  hovered: KLineData | null,
  dataList: KLineData[]
): Record<string, FundamentalItem> => {
  const isEn = locale === 'en-US'
  const t = (zhEn: string) => {
    const [zh, en] = zhEn.split('|')
    return isEn ? en : zh
  }

  let view = data
  const idx = hovered != null ? dataList.indexOf(hovered) : -1
  if (hovered != null && idx >= 0 && idx < dataList.length - 1) {
    const last = dataList[dataList.length - 1]
    const priceRatio = last.close !== 0 ? hovered.close / last.close : 1
    const volumeRatio = (last.volume ?? 0) !== 0 ? (hovered.volume ?? 0) / (last.volume ?? 0) : 1
    // 昨收：取前一根收盘；首根在分时下用基准昨收，否则用自身开盘
    const prevClose =
      idx > 0
        ? dataList[idx - 1].close
        : timeShareState.active && Number.isFinite(timeShareState.prevClose)
          ? timeShareState.prevClose
          : hovered.open
    const scale = (v?: number) => (v != null ? v * priceRatio : undefined)
    view = {
      ...data,
      turnoverRate: data.turnoverRate != null ? data.turnoverRate * volumeRatio : undefined,
      amplitude: prevClose !== 0 ? Math.abs((hovered.high - hovered.low) / prevClose) * 100 : undefined,
      pe: scale(data.pe),
      peDynamic: scale(data.peDynamic),
      peStatic: scale(data.peStatic),
      pb: scale(data.pb),
      totalMarketCap: scale(data.totalMarketCap),
      floatMarketCap: scale(data.floatMarketCap),
      avgPrice: scale(data.avgPrice)
    }
  }

  return {
    turnover: { label: t('换手率|Turnover'), value: fmt(view.turnoverRate) + (view.turnoverRate != null ? '%' : '') },
    amplitude: { label: t('振幅|Amplitude'), value: fmt(view.amplitude) + (view.amplitude != null ? '%' : '') },
    pe: { label: t('市盈|PE(TTM)'), value: fmt(view.pe) },
    peDynamic: { label: t('市盈动|PE(D)'), value: fmt(view.peDynamic) },
    peStatic: { label: t('市盈静|PE(S)'), value: fmt(view.peStatic) },
    pb: { label: t('市净率|PB'), value: fmt(view.pb) },
    totalMarketCap: { label: t('总市值|Total Cap'), value: fmt(view.totalMarketCap, 2, '亿') },
    floatMarketCap: { label: t('流通市值|Float Cap'), value: fmt(view.floatMarketCap, 2, '亿') },
    avgPrice: { label: t('均价|Avg Price'), value: fmt(view.avgPrice) }
  }
}
