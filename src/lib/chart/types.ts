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
  /** 官方当日开/高/低：分时分钟快照取不到盘中瞬时极值，信息表格以此为准 */
  open: number
  high: number
  low: number
  bars: KLineData[]
}

/** 板块榜单领涨股（可深链至看板终端） */
export interface BoardLeadingStock {
  market: string
  ticker: string
  name: string
  price: number | null
  changePct: number | null
}

/** 板块榜单条目（行业/概念维度，腾讯官方排名服务直供） */
export interface BoardRankItem {
  code: string // 板块代码（pt 前缀，仅标识用）
  name: string
  price: number | null // 板块指数点位
  change: number | null // 涨跌（点位）
  changePct: number | null // 涨跌幅(%)
  turnoverRate: number | null // 换手率(%)
  turnover: number | null // 成交额(元)
  leading: BoardLeadingStock | null
}

/** 行情中心总览（/api/market 单次下发：指数 + 板块榜 + 自选行情） */
export interface MarketOverview {
  indices: QuoteSnapshot[]
  ranking: BoardRankItem[]
  watches: QuoteSnapshot[]
}

/** 行情中心榜单维度：行业 / 概念 */
export type MarketBoard = 'industry' | 'concept'

/** 行情中心榜单排序键（上游支持的枚举子集：换手率不可排序） */
export type MarketBoardSort = 'changePct' | 'turnover'

/** 榜单排序方向：desc=降序（涨幅榜在前）/ asc=升序（跌幅榜在前） */
export type MarketSortDirection = 'asc' | 'desc'

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
