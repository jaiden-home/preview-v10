// ==================== 用户交易事件 + 事件引擎（环境无关，客户端/服务端共用） ====================
// UI 只描述"用户做了什么"（初始化委托 / 切换买卖 / 下买入单 / 下卖出单），不写执行逻辑；
// 事件统一由 applyTradeEvent 规则引擎驱动：下单事件先走 rules.validateOrder 校验，
// 通过后按 fillPriceOf 定价并执行账务。/trade 客户端本地执行与 /simtrade 服务端
// BFF 权威结算共用同一管线，两端口径零漂移。

import { executeBuy, executeSell, orderContextOf, type TradingAccount } from './account'
import { fillPriceOf, fractionQtyOf, maxBuyQty, validateOrder, type OrderRejection, type TradeSide } from './rules'

/** 下单事件 */
export interface PlaceOrderEvent {
  type: 'place_order'
  side: TradeSide
  code: string
  /** 标的名称（缺省空串：已持仓时沿用持仓名） */
  name?: string
  /** 委托价格 */
  price: number
  /** 委托数量（股） */
  qty: number
  /** 事件时间戳（服务端为虚拟日时间） */
  ts: number
}

/** 用户交易事件（UI 意图，与执行结果解耦）：初始化委托 / 切换买卖 / 下单 */
export type TradeEvent =
  | { type: 'init_order'; side: TradeSide; code: string; /** 委托数量比例（缺省 1 = 全仓） */ frac?: number }
  | { type: 'select_side'; side: TradeSide; code: string; /** 委托数量比例（缺省 1 = 全仓） */ frac?: number }
  | PlaceOrderEvent

/** 事件执行所需的最小行情快照（客户端实时行情 / 服务端回放行情同构） */
export interface MarketContext {
  /** 昨收（null = 跳过涨跌停校验） */
  prevClose: number | null
  /** 现价/今收（null = 缺行情，按委托价成交） */
  lastPrice: number | null
  /** 委托价（缺省回退现价）：买侧建议数量（最大可买）的计算基准——委托价变化时数量联动 */
  orderPrice?: number | null
}

/** 下单事件结果：规则拒绝（双语文案）或成交 */
export type PlaceOrderOutcome =
  | { kind: 'rejected'; rejection: OrderRejection }
  | {
      kind: 'executed'
      account: TradingAccount
      side: TradeSide
      code: string
      /** 实际成交价（有现价按现价） */
      price: number
      qty: number
    }

/**
 * 事件引擎总结果：
 * 初始化/切换买卖 → 侧别与建议委托数量（买侧 = 现价最大可买整手，卖侧 = 该标的 T+1 后可卖）；
 * 下单 → 拒绝或成交。
 */
export type TradeEventResult =
  | { kind: 'order_initialized'; side: TradeSide; /** 建议委托数量（股，0 = 清空） */ suggestedQty: number }
  | { kind: 'side_selected'; side: TradeSide; /** 建议委托数量（股，0 = 清空） */ suggestedQty: number }
  | PlaceOrderOutcome

/**
 * 下单管线：rules.validateOrder 校验 → fillPriceOf 定价 → executeBuy/executeSell 账务执行。
 * 客户端（/trade 本地成交）与服务端（/simtrade BFF placeOrderEngine 权威结算）共用；
 * 结果只有拒绝/成交两种，调用方按 kind 分派提示或落账。
 */
export const applyPlaceOrder = (
  account: TradingAccount,
  event: PlaceOrderEvent,
  market: MarketContext
): PlaceOrderOutcome => {
  const rejection = validateOrder({
    ...orderContextOf(account),
    side: event.side,
    code: event.code,
    price: event.price,
    qty: event.qty,
    prevClose: market.prevClose,
    lastPrice: market.lastPrice
  })
  if (rejection != null) {
    return { kind: 'rejected', rejection }
  }
  const price = fillPriceOf(event.price, market.lastPrice)
  // name 解析：事件缺省时沿用持仓名（新持仓无兜底则空串，账务层按 code 展示）
  const name = event.name ?? account.positions.find((p) => p.code === event.code)?.name ?? ''
  const input = { code: event.code, name, price, qty: event.qty, ts: event.ts }
  const next = event.side === 'buy' ? executeBuy(account, input) : executeSell(account, input)
  return { kind: 'executed', account: next, side: event.side, code: event.code, price, qty: event.qty }
}

/**
 * 建议委托数量：买侧基数 = 基准价（委托价，缺省现价）最大可买整手（缺价 0），
 * 卖侧基数 = 该标的 T+1 后可卖（无持仓 0）；再按比例取整手（frac ≥ 1 全仓原样，卖出可含零股）。
 */
const suggestQtyOf = (
  account: TradingAccount,
  side: TradeSide,
  code: string,
  market: MarketContext,
  frac = 1
): number => {
  let base: number
  if (side === 'buy') {
    const refPrice = market.orderPrice ?? market.lastPrice
    base = refPrice != null && refPrice > 0 ? maxBuyQty(account.cash, refPrice) : 0
  } else {
    base = account.positions.find((p) => p.code === code)?.availableQty ?? 0
  }
  return fractionQtyOf(base, frac)
}

/**
 * 事件引擎总入口（UI 全量事件驱动）：
 * init_order → 初始侧 + 默认委托数量（面板挂载/切标的首个行情快照，默认委托最大可买/可卖）；
 * select_side → 新侧 + 建议委托数量（可选比例 1/n 仓，基数变化时带比例重派即联动）；
 * place_order → 转发 applyPlaceOrder。纯函数：不修改入参账户，变更只体现在返回值。
 */
export const applyTradeEvent = (
  account: TradingAccount,
  event: TradeEvent,
  market: MarketContext
): TradeEventResult => {
  switch (event.type) {
    case 'init_order':
      return {
        kind: 'order_initialized',
        side: event.side,
        suggestedQty: suggestQtyOf(account, event.side, event.code, market, event.frac ?? 1)
      }
    case 'select_side':
      return {
        kind: 'side_selected',
        side: event.side,
        suggestedQty: suggestQtyOf(account, event.side, event.code, market, event.frac ?? 1)
      }
    case 'place_order':
      return applyPlaceOrder(account, event, market)
  }
}
