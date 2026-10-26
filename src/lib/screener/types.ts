// ==================== 量化选股域（环境无关，客户端与服务端共用） ====================
// 条件组合器模型：每条条件 = 指标(带参数) × 运算符 × 阈值，多条件 AND 组合。
// 指标计算见 indicators.ts；服务端分片编排在 lib/server/screener/。

/** 条目运算符：gt/lt/between 适用于数值型指标，bool 适用于布尔型指标 */
export type ScreenerOp = 'gt' | 'lt' | 'between' | 'bool'

export type ScreenerIndicatorKey =
  // 技术类（日 K 计算）
  | 'maDev' // 现价距 MA(n) 偏离度 %
  | 'changePctN' // N 日涨跌幅 %
  | 'rsi' // RSI(n)
  | 'volumeRatio' // 量能倍数（近5日均量 / 前20日均量）
  | 'offHighN' // 距 N 日高点回撤 %（≤0，越接近 0 越贴近高点；250 ≈ 52 周）
  | 'volatility' // N 日年化波动率 %
  | 'maBull' // 均线多头（MA5 > MA10 > MA20）
  | 'macdCross' // 近 N 日 MACD 金叉（DIF 上穿 DEA）
  // 基本面类（实时快照）
  | 'pe' // 市盈率 TTM
  | 'pb' // 市净率
  | 'floatCapYi' // 流通市值（亿）
  | 'turnoverRate' // 换手率 %

export interface IndicatorParamMeta {
  name: string
  /** 双语文案 */
  label: string
  min: number
  max: number
  def: number
}

export interface IndicatorMeta {
  key: ScreenerIndicatorKey
  /** 双语文案（下拉选项/结果列头） */
  label: string
  kind: 'technical' | 'fundamental'
  /** 布尔型指标仅允许 op=bool 且无阈值 */
  boolean: boolean
  /** 数值单位（展示用，可为空） */
  unit?: string
  params: IndicatorParamMeta[]
}

/** 指标库元数据（条件下拉、参数输入、结果列与校验的单一事实源） */
export const SCREENER_INDICATORS: IndicatorMeta[] = [
  {
    key: 'maDev',
    label: '现价距均线偏离|Price off MA',
    kind: 'technical',
    boolean: false,
    unit: '%',
    params: [{ name: 'n', label: '均线|MA', min: 5, max: 250, def: 20 }]
  },
  {
    key: 'changePctN',
    label: 'N日涨跌幅|N-day change',
    kind: 'technical',
    boolean: false,
    unit: '%',
    params: [{ name: 'n', label: '天数|Days', min: 2, max: 250, def: 20 }]
  },
  {
    key: 'rsi',
    label: 'RSI|RSI',
    kind: 'technical',
    boolean: false,
    params: [{ name: 'n', label: '周期|Period', min: 2, max: 60, def: 14 }]
  },
  {
    key: 'volumeRatio',
    label: '量能倍数|Volume ratio',
    kind: 'technical',
    boolean: false,
    unit: 'x|倍',
    params: []
  },
  {
    key: 'offHighN',
    label: '距N日高点回撤|Off N-day high',
    kind: 'technical',
    boolean: false,
    unit: '%',
    params: [{ name: 'n', label: '天数|Days', min: 10, max: 250, def: 250 }]
  },
  {
    key: 'volatility',
    label: '年化波动率|Annualized vol',
    kind: 'technical',
    boolean: false,
    unit: '%',
    params: [{ name: 'n', label: '天数|Days', min: 20, max: 120, def: 20 }]
  },
  {
    key: 'maBull',
    label: '均线多头|MA bullish',
    kind: 'technical',
    boolean: true,
    params: []
  },
  {
    key: 'macdCross',
    label: 'MACD金叉|MACD golden cross',
    kind: 'technical',
    boolean: true,
    params: [{ name: 'n', label: '近N日|Within days', min: 2, max: 60, def: 10 }]
  },
  {
    key: 'pe',
    label: '市盈率TTM|PE (TTM)',
    kind: 'fundamental',
    boolean: false,
    params: []
  },
  {
    key: 'pb',
    label: '市净率|PB',
    kind: 'fundamental',
    boolean: false,
    params: []
  },
  {
    key: 'floatCapYi',
    label: '流通市值|Float cap',
    kind: 'fundamental',
    boolean: false,
    unit: '亿|100M',
    params: []
  },
  {
    key: 'turnoverRate',
    label: '换手率|Turnover rate',
    kind: 'fundamental',
    boolean: false,
    unit: '%',
    params: []
  }
]

export const screenerIndicatorOf = (key: string): IndicatorMeta | undefined =>
  SCREENER_INDICATORS.find((meta) => meta.key === key)

/** 单条筛选条件 */
export interface ScreenerCondition {
  key: ScreenerIndicatorKey
  /** 参数取值（键名与 IndicatorMeta.params 对齐；无参数指标为空对象） */
  params: Record<string, number>
  op: ScreenerOp
  /** gt/lt 阈值 */
  value?: number
  /** between 下/上限 */
  min?: number
  max?: number
}

/** 运行请求（POST /api/screener）；股票池固定 = 沪深主板探测池（v2.62 起移除「仅自选」） */
export interface ScreenerRunRequest {
  conditions: ScreenerCondition[]
  /** 起始日期 'YYYY-MM-DD'：与 asOf 组成扫描区间——区间内任一交易日命中即算（取最近命中日） */
  from?: string
  /** 截止日期 'YYYY-MM-DD'：按该历史日的行情计算指标（缺省 = 最新交易日；限最近一年内） */
  asOf?: string
}

/** 结果条目：命中标的 + 各条件指标值（布尔型指标值为 1/0） */
export interface ScreenerResultItem {
  code: string
  name: string
  price: number | null
  changePct: number | null
  values: Record<string, number | null>
  /** 命中交易日 'yyyy-mm-dd'（区间/单日历史模式返回；当前模式缺省） */
  hitDate?: string | null
}

/** 运行视图：分片渐进（done=false 时前端带同参数继续请求，服务端按游标续算） */
export interface ScreenerRunView {
  done: boolean
  computed: number
  total: number
  items: ScreenerResultItem[]
}

export const SCREENER_MAX_CONDITIONS = 8

// ==================== 领涨看板视图（SSR 与 /api/screener/board 共用；计算在 lib/server/market-db/board.ts） ====================

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
