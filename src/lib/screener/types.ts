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
