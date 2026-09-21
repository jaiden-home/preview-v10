import type { KLineData } from 'klinecharts'

/** 标的引用（市场前缀 + 6 位代码） */
export interface SymbolRef {
  market: string
  ticker: string
}

export interface SymbolSearchItem {
  ticker: string
  name: string
  market: string
}

/** 基本面指标（腾讯实时行情字段直供或历史回溯近似） */
export interface FundamentalData {
  pe?: number // 市盈率(TTM)
  peDynamic?: number // 动态市盈率
  peStatic?: number // 静态市盈率
  pb?: number // 市净率
  turnoverRate?: number // 换手率(%)
  amplitude?: number // 振幅(%)
  totalMarketCap?: number // 总市值(元)
  floatMarketCap?: number // 流通市值(元)
  avgPrice?: number // 均价
}

/** 实时行情快照：名称 + 现价/昨收 + 基本面（服务端聚合后一次下发） */
export interface QuoteSnapshot {
  market: string
  ticker: string
  name: string | null
  price: number | null
  prevClose: number | null
  fundamental: FundamentalData
}

/** 分时快照：最新交易日分钟 bar 列表 + 昨收基准 */
export interface TimeShareSnapshot {
  date: string
  prevClose: number
  bars: KLineData[]
}

/** 标的代码合法性：sh/sz/bj + 6 位数字 */
export const SYMBOL_PATTERN = /^(sh|sz|bj)\d{6}$/

export const isValidSymbolCode = (code: string): boolean => SYMBOL_PATTERN.test(code)

export const symbolCode = (symbol: SymbolRef): string => `${symbol.market}${symbol.ticker}`

/** 解析 'sh600519' 形式的标的代码 */
export const parseSymbolCode = (code: string): (SymbolRef & { code: string }) | null => {
  const match = code.match(SYMBOL_PATTERN)
  if (match == null) {
    return null
  }
  return { code, market: code.slice(0, 2), ticker: code.slice(2) }
}
