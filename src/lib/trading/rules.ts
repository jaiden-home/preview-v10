// ==================== A 股买卖规则（环境无关纯函数，可复用可测试） ====================
// 标的准入、涨跌停、交易费用、整手/T+1、现价成交、下单校验与成交价。
// 不依赖任何账户模型——校验所需的现金与可卖数量由调用方注入 OrderValidationContext，
// 可被 SSR、客户端与服务端（lib/server/trading）共同引用与独立测试。

import { msg } from './messages'

/** 佣金费率（万 2.5，双边） */
export const COMMISSION_RATE = 0.00025
/** 单笔最低佣金（元） */
export const COMMISSION_MIN = 5
/** 印花税率（万 5，仅卖出双边中的卖方） */
export const STAMP_TAX_RATE = 0.0005
/** 过户费率（十万分之 1，双边） */
export const TRANSFER_FEE_RATE = 0.00001
/** 每手股数（A 股买入最小单位） */
export const LOT_SIZE = 100

export type TradeSide = 'buy' | 'sell'

/**
 * 分位取整：与 UI 展示/预填的 toFixed(2) 严格同口径（Number(n.toFixed(2))）。
 * 勿改回 Math.round(n * 100) / 100：浮点乘法恰好落到 .5 时与显示舍入分叉——
 * 如前复权收盘 11.385 显示 11.38，旧式取整却得 11.39，导致"委托价 = 显示现价"被误拒。
 */
export const round2 = (n: number): number => Number(n.toFixed(2))

// ==================== 标的与涨跌停 ====================

/** A 股个股可交易前缀（指数/ETF 等不在模拟交易范围） */
const STOCK_TICKER_PATTERN: Record<string, RegExp> = {
  sh: /^(60|68)/,
  sz: /^(00|30)/,
  bj: /^(43|83|87|88|92)/
}

/** 是否为可模拟交易的 A 股个股（排除指数 sh000/sz399 与 ETF 等） */
export const isTradableCode = (code: string): boolean => {
  const pattern = STOCK_TICKER_PATTERN[code.slice(0, 2)]
  return pattern?.test(code.slice(2)) ?? false
}

/** 涨跌幅限制：主板 ±10%，科创板/创业板 ±20%，北交所 ±30% */
export const limitRatioOf = (code: string): number => {
  if (code.startsWith('sh68') || code.startsWith('sz30')) {
    return 0.2
  }
  if (code.startsWith('bj')) {
    return 0.3
  }
  return 0.1
}

export interface PriceLimits {
  upper: number
  lower: number
}

export const limitPricesOf = (prevClose: number, code: string): PriceLimits => {
  const ratio = limitRatioOf(code)
  return { upper: round2(prevClose * (1 + ratio)), lower: round2(prevClose * (1 - ratio)) }
}

// ==================== 费用与数量 ====================

/** 交易费用：佣金（最低 5 元）+ 过户费（双边）+ 印花税（仅卖出） */
export const calcFees = (side: TradeSide, amount: number): number => {
  if (amount <= 0) {
    return 0
  }
  const commission = Math.max(amount * COMMISSION_RATE, COMMISSION_MIN)
  const transfer = amount * TRANSFER_FEE_RATE
  const stamp = side === 'sell' ? amount * STAMP_TAX_RATE : 0
  return round2(commission + transfer + stamp)
}

/** 最大可买数量（股，整手，扣除预估费用） */
export const maxBuyQty = (cash: number, price: number): number => {
  if (price <= 0) {
    return 0
  }
  let lots = Math.floor(cash / (price * LOT_SIZE))
  while (lots > 0) {
    const amount = round2(price * lots * LOT_SIZE)
    if (amount + calcFees('buy', amount) <= cash) {
      break
    }
    lots -= 1
  }
  return lots * LOT_SIZE
}

/**
 * 比例仓数量（1/n 仓快捷键与联动共用）：全仓（frac ≥ 1）原样返回——
 * 买入为最大可买（整手），卖出为全部可卖（可含零股清仓）；
 * 非全仓一律向下取整手（epsilon 吸收比例乘法的浮点尾巴，如 900 × 1/3 = 299.99…）。
 */
export const fractionQtyOf = (base: number, frac: number): number =>
  frac >= 1 ? base : Math.floor((base * frac) / LOT_SIZE + 1e-9) * LOT_SIZE

// ==================== 下单校验 ====================

/**
 * 下单校验所需的账户上下文（与账户模型解耦，由调用方投影注入）：
 * cash = 可用现金；availableQty = 各标的可卖数量（T+1 后可用，无持仓的标的缺省 0）。
 */
export interface OrderValidationContext {
  cash: number
  availableQty: Record<string, number>
}

export interface OrderValidationInput extends OrderValidationContext {
  side: TradeSide
  code: string
  price: number
  qty: number
  /** 昨收（null 时跳过涨跌停校验） */
  prevClose: number | null
  /** 现价/今收（null 时跳过可成交校验，按委托价成交） */
  lastPrice?: number | null
}

/** 下单校验拒绝码（服务端错误响应与前端提示共用） */
export type OrderRejectCode =
  | 'not_tradable'
  | 'invalid_price'
  | 'price_limit'
  | 'price_unfillable'
  | 'invalid_qty'
  | 'lot_size'
  | 'insufficient_cash'
  | 'insufficient_qty'

export interface OrderRejection {
  code: OrderRejectCode
  /** 双语文案键（zh|en），前端 t() 直出 */
  message: string
}

/**
 * 下单校验，返回拒绝原因（code + 双语文案键）或 null（通过）。
 * 买入：可交易标的 / 价格有效且在涨跌停内 / 委托价不低于现价（可成交） / 整手 / 资金充足。
 * 卖出：另校验可卖数量与委托价不高于现价。
 */
export const validateOrder = (input: OrderValidationInput): OrderRejection | null => {
  const { cash, availableQty, side, code, price, qty, prevClose, lastPrice = null } = input
  if (!isTradableCode(code)) {
    return { code: 'not_tradable', message: msg('not_tradable') }
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { code: 'invalid_price', message: msg('invalid_price') }
  }
  if (prevClose != null && prevClose > 0) {
    const { upper, lower } = limitPricesOf(prevClose, code)
    if (price > upper || price < lower) {
      return {
        code: 'price_limit',
        message: msg('price_limit', { lower: lower.toFixed(2), upper: upper.toFixed(2) })
      }
    }
  }
  // 现价成交规则：买入委托价低于现价、卖出委托价高于现价 → 不能成交。
  // 比较按分位取整：行情现价可能带浮点尾巴/亚分位（如 18.72999…），
  // 与提示展示的两位价同口径，避免"委托价 = 显示现价"仍被拒
  if (lastPrice != null && lastPrice > 0) {
    const orderPx = round2(price)
    const marketPx = round2(lastPrice)
    if (side === 'buy' ? orderPx < marketPx : orderPx > marketPx) {
      return {
        code: 'price_unfillable',
        message: msg(side === 'buy' ? 'price_unfillable_buy' : 'price_unfillable_sell', {
          px: marketPx.toFixed(2)
        })
      }
    }
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    return { code: 'invalid_qty', message: msg('invalid_qty') }
  }
  if (side === 'buy') {
    if (qty % LOT_SIZE !== 0) {
      return { code: 'lot_size', message: msg('lot_size') }
    }
    const amount = round2(price * qty)
    const fee = calcFees('buy', amount)
    if (amount + fee > cash + 1e-6) {
      return { code: 'insufficient_cash', message: msg('insufficient_cash') }
    }
    return null
  }
  if ((availableQty[code] ?? 0) < qty) {
    return {
      code: 'insufficient_qty',
      message: msg('insufficient_qty')
    }
  }
  return null
}

/**
 * 成交价：有现价时一律按现价成交（委托价优于现价的部分让渡给对手方，
 * 与真实限价单撮合一致，按分位取整与校验/展示同口径），缺行情回退委托价。
 * 调用前需先通过 validateOrder。
 */
export const fillPriceOf = (price: number, lastPrice: number | null): number =>
  lastPrice != null && lastPrice > 0 ? round2(lastPrice) : price
