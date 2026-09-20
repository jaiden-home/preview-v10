import type { KLineData } from 'klinecharts'
import { CN_DOWN_COLOR, CN_FLAT_COLOR, CN_UP_COLOR } from './constants'
import { buildFundamentalItems } from '../fundamental'
import type { FundamentalData } from './types'
import type { Locale } from '../i18n'
import { createT } from '../i18n'

export interface InfoCell {
  label: string
  value: string
  color?: string
  cellClass?: string
}

export interface InfoSnapshotSource {
  dataList: KLineData[]
  hovered: KLineData | null
  fundamental: FundamentalData
  /** 分时或分钟/小时级周期：时间列显示到时分 */
  intraday: boolean
}

const formatVolumeText = (volume: number): string => {
  const abs = Math.abs(volume)
  if (abs >= 1e8) return `${(volume / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(volume / 1e4).toFixed(2)}万`
  return `${volume}`
}

const formatBarTime = (timestamp: number, intraday: boolean): string => {
  const date = new Date(timestamp)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return intraday ? `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}` : ymd
}

/**
 * 信息表格数据（K线行情 + 基本面混排，随十字光标联动）。
 * 统一布局：PC 端 8 列 2 行 / 移动端 4 列 4 行
 * 行1：时间 今价 今开 最高 最低 均价 涨跌 振幅
 * 行2：换手率 成交量 总市值 流通市值 市盈 市盈动 市盈静 市净率
 * 返回 null 表示暂无数据（渲染加载占位）。
 */
export const buildInfoCells = (source: InfoSnapshotSource, locale: Locale): InfoCell[] | null => {
  const { dataList, hovered, fundamental, intraday } = source
  if (dataList.length === 0) {
    return null
  }
  const t = createT(locale)
  const found = hovered != null ? dataList.indexOf(hovered) : -1
  const i = found >= 0 ? found : dataList.length - 1
  const current = dataList[i]
  // 与图上一致：按昨收判定红涨绿跌
  const prevClose = i > 0 ? dataList[i - 1].close : current.open
  const change = current.close - prevClose
  const pct = prevClose !== 0 ? (change / prevClose) * 100 : 0
  const color = change > 0 ? CN_UP_COLOR : change < 0 ? CN_DOWN_COLOR : CN_FLAT_COLOR
  const sign = change > 0 ? '+' : ''
  const fixed = (v: number) => v.toFixed(2)
  const neutral = 'var(--tb-text)'
  const ohlc: Record<string, InfoCell> = {
    time: {
      label: t('时间|Time'),
      value: formatBarTime(current.timestamp, intraday),
      color: neutral,
      cellClass: 'cell-time'
    },
    open: { label: t('今开|Open'), value: fixed(current.open) },
    close: { label: t('今价|Close'), value: fixed(current.close) },
    high: { label: t('最高|High'), value: fixed(current.high) },
    low: { label: t('最低|Low'), value: fixed(current.low) },
    chg: { label: t('涨跌|Chg'), value: `${sign}${fixed(change)} (${sign}${fixed(pct)}%)` },
    vol: { label: t('成交量|Vol'), value: formatVolumeText(current.volume ?? 0) }
  }
  const fund = buildFundamentalItems(fundamental, locale, hovered, dataList)
  // 行1 的 均价/涨跌/振幅/开/收/高/低 随红涨绿跌着色（时间除外）；行2 与当日涨跌无关，统一中性色
  const neutralCell = (cell: { label: string; value: string }): InfoCell => ({ ...cell, color: neutral })
  const trendCell = (cell: { label: string; value: string }): InfoCell => ({ ...cell, color })
  return [
    ohlc.time,
    trendCell(ohlc.close),
    trendCell(ohlc.open),
    trendCell(ohlc.high),
    trendCell(ohlc.low),
    trendCell(fund.avgPrice),
    trendCell(ohlc.chg),
    trendCell(fund.amplitude),
    neutralCell(fund.turnover),
    neutralCell(ohlc.vol),
    neutralCell(fund.totalMarketCap),
    neutralCell(fund.floatMarketCap),
    neutralCell(fund.pe),
    neutralCell(fund.peDynamic),
    neutralCell(fund.peStatic),
    neutralCell(fund.pb)
  ]
}
