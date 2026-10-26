// ==================== 领涨看板视图类型（环境无关，客户端与服务端共用） ====================
// SSR 与 /api/screener/board 共用；计算在 lib/server/market-db/board.ts。

/** 看板元信息（数据总览卡） */
export interface BoardMeta {
  lastDate: string
  stocks: number
  concepts: number
  filtered: number
  /** 历史领涨股总数（趋势过滤前） */
  leaderStocks: number
  /** 历史领涨日总数 */
  leaderDays: number
}

/** 概念热力块（treemap 单元；四周期共用结构） */
export interface ConceptHeat {
  code: string
  name: string
  /** 所属大类（热力图分组） */
  category: string
  n: number
  up: number
  evalN: number
  /** 等权平均涨幅 % */
  avgPct: number
  leader: { code: string; name: string; pct: number } | null
}

/** 热力周期：日 = 昨收基准；周/月/年 = 近 7/30/365 自然日（基准 = 窗口起点前最后交易日收盘） */
export type HeatPeriodKey = 'day' | 'week' | 'month' | 'year'
export type HeatPeriods = Record<HeatPeriodKey, ConceptHeat[]>

/** 领涨股行（趋势达标后全部指标；exchange 用于拼 sh/sz 前缀码深链） */
export interface LeaderRow {
  code: string
  name: string
  exchange: string
  /** 领涨天数（全部历史，同日多概念不重复计） */
  days: number
  /** 一年领涨天数（近 365 自然日） */
  days365: number
  /** 事件总数（股票×概念×日，仅悬浮参考） */
  events: number
  /** 最近领涨日（默认排序次级键，不展示） */
  lastDate: string
  /** 全部历史领涨概念（展示 + 热力联动/搜索） */
  concepts: string[]
  /** 当前概念所属大类（一股一概念；大板块筛选口径） */
  category: string | null
  /** 最新交易日涨幅 % */
  pct: number | null
  /** 最近买入点（近 1 年内最后一个 B 日；null = 窗口内无） */
  lastBuy: string | null
  /** 连涨天数（最新日为终点的收盘连涨数） */
  streak: number
  /** 连高天数（最新日为终点的最高价连高数） */
  highStreak: number
  /** 趋势向上（MA30>MA60 与 收盘>MA60 均持续超 15 个交易日） */
  fastFlip: boolean
  /** B 点连涨（最近 B 日后连续上涨数；断链冻结；无 B = null） */
  buyStreak: number | null
  /** 均线比 MA30 ÷ MA60（不足 60 根 = null） */
  maRatio: number | null
  /** 趋势天数（近 1 年内 MA30>MA60 最长连续） */
  trendDays: number
  /** 最新收盘价 */
  price: number | null
  /** 半年最高价（近 182 自然日） */
  highHalf: number | null
  /** 一年最高价（近 365 自然日） */
  highYear: number | null
  /** 一年涨停次数（主板 10% / 创业板 20%，容差 0.05） */
  limitUp365: number
  /** 本月新进 */
  isNew: boolean
  /** 本月进入日（新进=首进日；掉出又回来=最近重进日；一直在 = null） */
  joinDate: string | null
}

/** 看板数据（SSR 初载 + /api/screener/board 刷新共用结构） */
export interface BoardData {
  meta: BoardMeta
  periods: HeatPeriods
  leaders: LeaderRow[]
  /** 大类展示序列（concepts.sort 序） */
  categories: string[]
}
