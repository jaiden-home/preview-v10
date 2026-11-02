/** 策略模拟（A‴ 方案）视图类型域（环境无关，SSR 与 /api/strategy 共用） */

/** B 点（买入信号）参数：lib/trading/signal 的买入口径，策略按版本可调（SimTrading 极速模拟用默认值） */
export interface BPointParams {
  /** 连续强涨窗口长度（日；窗口末日为第 N 日） */
  runDays: number
  /** 高点容差：窗口内每日 最高 ≥ 前日最高 × N（0.999 = 平高/针尖误差亦算） */
  highTol: number
  /** 均线门槛：窗口末日收盘 ≥ MA(N)（窗口不足不判定） */
  maDays: number
  /** 动能保护·修复下限：窗口末两日涨幅之和 ≥ 首日涨幅 × N */
  tailRepairMin: number
  /** 动能保护·衰减下限：末日涨幅 ≥ 前日涨幅 × N */
  fadeRatio: number
}

/** 策略参数（与回测定型版一致；展示用，暂不开放调参） */
export interface StrategyParams {
  /** 日榜走查深度（前 N 名逐个校验） */
  walkN: number
  /** 周榜连升快照数（3 = 两周前→上周→本周） */
  weeks: number
  /** 当日涨幅下限（%） */
  pctLo: number
  /** 当日涨幅上限（%） */
  pctHi: number
  /** 止盈线（小数，0.03 = +3%） */
  takeProfit: number
  /** 保本止损缓冲（小数，0 = 无缓冲：收盘 < 买入价即离场；0.02 = 收盘 < 买入价×0.98 离场） */
  stopBuffer: number
  /** 单板块持仓上限（按均线比降序取前 N 只） */
  maxPick: number
  /** 初始资金（元） */
  capital: number
  /** 买入点（B 点）口径 */
  bPoint: BPointParams
}

/** 策略版本定义：条件参数集 + 起始日。改条件 = 在注册表追加新版本（v2、v3…），不覆盖历史版本——净值曲线按版本对比 */
export interface StrategyVersionDef {
  /** 版本号（'v1' | 'v2' …，注册表末位 = 当前执行版本） */
  id: string
  /** 版本说明（一句话变更点，页面展示） */
  label: string
  /** 起始日（含） */
  start: string
  params: StrategyParams
}

/** 多版本策略数据束（SSR 与 /api/strategy 共用） */
export interface StrategyBundle {
  /** 当前执行版本 id（注册表末位） */
  active: string
  /** 版本注册顺序（id 升序 = 注册顺序） */
  order: string[]
  versions: Record<string, StrategyData | null>
}

/** 买入成交 */
export interface StrategyBuy {
  code: string
  name: string
  concept: string
  /** 当日涨幅（%） */
  pct: number
  /** 均线比 MA30÷MA60（窗口不足为 null） */
  maRatio: number | null
  /** 成交价（=当日收盘） */
  price: number
}

/** 卖出成交 */
export interface StrategySell {
  code: string
  name: string
  concept: string
  buyDate: string
  buyPrice: number
  sellDate: string
  sellPrice: number
  /** 持仓交易日数 */
  holdDays: number
  /** 收益率（%） */
  pnlPct: number
  /** 盈亏（元） */
  pnl: number
  /** 离场原因：breakeven=保本止损 takeprofit=止盈 */
  reason: 'breakeven' | 'takeprofit'
}

/** 期末持仓（按最后收盘估值） */
export interface StrategyPosition {
  code: string
  name: string
  concept: string
  buyDate: string
  buyPrice: number
  lastClose: number
  /** 浮动盈亏（%） */
  floatPct: number
  /** 市值（元） */
  value: number
  /** 距止盈还需涨幅（%；已为负表示已越过止盈线） */
  toTp: number
  /** 距保本线的缓冲（%）：现价高出买入价的幅度 */
  toStop: number
}

/** 最近交易日·日榜走查行（决策透视） */
export interface StrategyWalkRow {
  /** 日榜名次 */
  rank: number
  concept: string
  /** 当日板块等权涨幅（%） */
  dayAvg: number
  /** 周榜排名链（两周前→上周→本周，快照相隔 7 自然日） */
  chain: string
  /** 昨日周榜排名（null=未上榜） */
  rD: number | null
  /** 是否三周连升（含今日较昨日上升） */
  rising: boolean
  /** 板块内是否有候选（B 点 + 涨幅 3~5%） */
  hasCand: boolean
}

/** 每日流水 */
export interface StrategyDay {
  date: string
  /** 当日入选板块（null=前 20 名全不满足） */
  selected: { concept: string; rank: number; chain: string; rD: number | null } | null
  buys: StrategyBuy[]
  sells: StrategySell[]
  /** 现金（元） */
  cash: number
  /** 净值（元） */
  equity: number
}

/** 策略模拟数据（market.db 只读快照计算） */
export interface StrategyData {
  meta: {
    /** 策略版本（StrategyVersionDef.id） */
    version: string
    /** 版本说明（StrategyVersionDef.label） */
    versionLabel: string
    /** 策略起始日（含） */
    startDate: string
    /** 快照数据截至日 */
    lastDate: string
    /** 交易日数 */
    tradingDays: number
    params: StrategyParams
  }
  summary: {
    equity: number
    cash: number
    marketValue: number
    /** 总收益（%） */
    returnPct: number
    closedCount: number
    winCount: number
  }
  /** 净值曲线（逐交易日） */
  equityCurve: Array<{ date: string; equity: number }>
  /** 每日流水（全量） */
  days: StrategyDay[]
  /** 期末持仓 */
  positions: StrategyPosition[]
  /** 已平仓成交（时间倒序） */
  trades: StrategySell[]
  /** 最近交易日的走查透视 */
  latest: {
    date: string
    /** 日榜前 N 走查状态 */
    walk: StrategyWalkRow[]
  }
}
