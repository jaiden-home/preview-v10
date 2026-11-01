/** 策略模拟（A‴ 方案）视图类型域（环境无关，SSR 与 /api/strategy 共用） */

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
  /** 单板块持仓上限（按均线比降序取前 N 只） */
  maxPick: number
  /** 初始资金（元） */
  capital: number
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
