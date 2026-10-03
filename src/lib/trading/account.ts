// ==================== 模拟交易域逻辑（纯函数 + localStorage 持久化） ====================
// 账户账务与持仓：整手买入执行、T+1 冻结解冻、已实现盈亏、权益与持久化。
// 买卖规则（标的准入/涨跌停/费用/下单校验）见 rules.ts；本文件全部为环境无关纯函数，
// 可被 SSR 与客户端共同引用（持久化函数仅客户端调用）。

import type { SymbolRef } from '@/lib/chart/types'
import { LOT_SIZE, calcFees, round2, type OrderValidationContext, type TradeSide } from './rules'

/** 初始虚拟资金（100 万） */
export const INITIAL_CASH = 1_000_000

/** 成交记录上限（约束 localStorage 体积） */
export const MAX_TRADE_RECORDS = 200

const ACCOUNT_STORAGE_KEY = 'klinecharts-paper-account'
const SYMBOL_STORAGE_KEY = 'klinecharts-paper-symbol'

/** 极速模拟（/simtrade）独立存储 key：账户与选中标的两页互不干扰 */
export const REPLAY_ACCOUNT_STORAGE_KEY = 'klinecharts-paper-account-replay'
export const REPLAY_SYMBOL_STORAGE_KEY = 'klinecharts-paper-symbol-replay'

// ==================== 类型 ====================

export interface TradeRecord {
  id: string
  /** 成交日期时间戳（截断至本地当日 00:00，不记时分秒） */
  ts: number
  code: string
  name: string
  side: TradeSide
  price: number
  /** 成交数量（股） */
  qty: number
  /** 成交金额（元） */
  amount: number
  /** 费用合计（元） */
  fee: number
  /** 卖出已实现盈亏（买入为 null） */
  realizedPnl: number | null
}

export interface Position {
  code: string
  name: string
  /** 总持股（股） */
  qty: number
  /** 可卖数量（T+1 限制后的可用） */
  availableQty: number
  /** 当日买入冻结（T+1 不可卖） */
  frozenQty: number
  /** 冻结发生日 yyyy-mm-dd */
  frozenDate: string
  /** 摊薄成本价（含买入费用，元） */
  costPrice: number
}

export interface TradingAccount {
  cash: number
  initialCapital: number
  /** 当日基准日 yyyy-mm-dd（用于当日盈亏） */
  dayKey: string
  /** 当日起始总资产（用于当日盈亏） */
  dayStartEquity: number
  positions: Position[]
  /** 新成交在前 */
  trades: TradeRecord[]
}

export interface OrderInput {
  code: string
  name: string
  price: number
  qty: number
  ts: number
}

// ==================== 基础工具 ====================

/** 本地时区 yyyy-mm-dd（T+1 与当日盈亏的日界） */
export const dayKeyOf = (ts: number): string => {
  const d = new Date(ts)
  const month = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** 截断到本地日界的时间戳（成交记录仅记日期） */
const dayStartOf = (ts: number): number => {
  const [y, m, d] = dayKeyOf(ts).split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

// ==================== 账户与执行 ====================

export const createInitialAccount = (ts: number = Date.now()): TradingAccount => ({
  cash: INITIAL_CASH,
  initialCapital: INITIAL_CASH,
  dayKey: dayKeyOf(ts),
  dayStartEquity: INITIAL_CASH,
  positions: [],
  trades: []
})

/**
 * T+1 解冻：把非当日买入的冻结股数并入可卖。
 * 在账户加载、下单执行与跨日轮询时调用。
 */
export const unfreezePositions = (account: TradingAccount, today: string): TradingAccount => {
  const positions = account.positions.map((p) =>
    p.frozenQty > 0 && p.frozenDate < today ? { ...p, availableQty: p.qty, frozenQty: 0, frozenDate: '' } : p
  )
  return positions === account.positions ? account : { ...account, positions }
}

const nextTradeId = (ts: number): string => `${ts.toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const appendTrade = (account: TradingAccount, record: Omit<TradeRecord, 'id'>): TradeRecord[] => {
  // 成交记录仅记日期：ts 截断至本地日界，不记时分秒
  const trade: TradeRecord = { ...record, ts: dayStartOf(record.ts), id: nextTradeId(record.ts) }
  return [trade, ...account.trades].slice(0, MAX_TRADE_RECORDS)
}

/** 买入：摊薄成本含费用；新买入股数当日冻结（T+1）。调用方需先通过 validateOrder */
export const executeBuy = (account: TradingAccount, order: OrderInput): TradingAccount => {
  const { code, name, price, qty, ts } = order
  if (qty <= 0 || qty % LOT_SIZE !== 0 || price <= 0) {
    throw new Error(`invalid buy order: ${code} ${price} x ${qty}`)
  }
  const today = dayKeyOf(ts)
  const base = unfreezePositions(account, today)
  const amount = round2(price * qty)
  const fee = calcFees('buy', amount)
  if (amount + fee > base.cash + 1e-6) {
    throw new Error(`insufficient cash: need ${amount + fee}, have ${base.cash}`)
  }

  const held = base.positions.find((p) => p.code === code)
  const position: Position =
    held == null
      ? {
          code,
          name,
          qty,
          availableQty: 0,
          frozenQty: qty,
          frozenDate: today,
          costPrice: round2((amount + fee) / qty)
        }
      : {
          ...held,
          name: name || held.name,
          qty: held.qty + qty,
          frozenQty: held.frozenQty + qty,
          frozenDate: today,
          costPrice: round2((held.costPrice * held.qty + amount + fee) / (held.qty + qty))
        }
  const positions = [...base.positions.filter((p) => p.code !== code), position]

  return {
    ...base,
    cash: round2(base.cash - amount - fee),
    positions,
    trades: appendTrade(base, { ts, code, name, side: 'buy', price, qty, amount, fee, realizedPnl: null })
  }
}

/** 卖出：仅可卖部分（T+1），成本价不变，落袋已实现盈亏。调用方需先通过 validateOrder */
export const executeSell = (account: TradingAccount, order: OrderInput): TradingAccount => {
  const { code, name, price, qty, ts } = order
  if (qty <= 0 || price <= 0) {
    throw new Error(`invalid sell order: ${code} ${price} x ${qty}`)
  }
  const today = dayKeyOf(ts)
  const base = unfreezePositions(account, today)
  const held = base.positions.find((p) => p.code === code)
  if (held == null || held.availableQty < qty) {
    throw new Error(`insufficient available qty of ${code}`)
  }

  const amount = round2(price * qty)
  const fee = calcFees('sell', amount)
  const realizedPnl = round2((price - held.costPrice) * qty - fee)
  const remainingQty = held.qty - qty
  const positions = base.positions
    .map((p) =>
      p.code === code
        ? remainingQty === 0
          ? null
          : { ...p, name: name || p.name, qty: remainingQty, availableQty: p.availableQty - qty }
        : p
    )
    .filter((p): p is Position => p != null)

  return {
    ...base,
    cash: round2(base.cash + amount - fee),
    positions,
    trades: appendTrade(base, { ts, code, name, side: 'sell', price, qty, amount, fee, realizedPnl })
  }
}

// ==================== 校验上下文 ====================

/**
 * 账户 → 下单校验上下文（rules.validateOrder 的账户投影）：
 * 可用现金 + 各标的可卖数量（T+1 后可用）。跨日调用前先 unfreezePositions。
 */
export const orderContextOf = (account: TradingAccount): OrderValidationContext => ({
  cash: account.cash,
  availableQty: Object.fromEntries(account.positions.map((p) => [p.code, p.availableQty]))
})

// ==================== 权益 ====================

export interface EquitySnapshot {
  /** 持仓市值 */
  marketValue: number
  /** 总资产 = 现金 + 持仓市值 */
  totalAssets: number
  /** 总盈亏 = 总资产 - 初始资金 */
  totalPnl: number
  /** 总收益率（%） */
  totalPnlPct: number
  /** 持仓浮动盈亏 */
  positionPnl: number
  /** 当日盈亏（相对 dayStartEquity） */
  dayPnl: number
}

/** prices: code -> 现价（缺省回退成本价） */
export const calcEquity = (account: TradingAccount, prices: Record<string, number>): EquitySnapshot => {
  let marketValue = 0
  let positionPnl = 0
  for (const p of account.positions) {
    const price = prices[p.code] ?? p.costPrice
    const value = round2(price * p.qty)
    marketValue += value
    positionPnl += round2((price - p.costPrice) * p.qty)
  }
  marketValue = round2(marketValue)
  positionPnl = round2(positionPnl)
  const totalAssets = round2(account.cash + marketValue)
  const totalPnl = round2(totalAssets - account.initialCapital)
  return {
    marketValue,
    totalAssets,
    totalPnl,
    totalPnlPct: account.initialCapital > 0 ? round2((totalPnl / account.initialCapital) * 100) : 0,
    positionPnl,
    dayPnl: round2(totalAssets - account.dayStartEquity)
  }
}

// ==================== 持久化（仅客户端） ====================

interface StoredAccount {
  version: 1
  account: TradingAccount
}

export const loadAccount = (key: string = ACCOUNT_STORAGE_KEY): TradingAccount | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) {
      return null
    }
    const parsed = JSON.parse(raw) as StoredAccount
    if (parsed?.version !== 1 || typeof parsed.account?.cash !== 'number') {
      return null
    }
    return unfreezePositions(parsed.account, dayKeyOf(Date.now()))
  } catch {
    return null
  }
}

export const saveAccount = (account: TradingAccount, key: string = ACCOUNT_STORAGE_KEY): void => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    const stored: StoredAccount = { version: 1, account }
    window.localStorage.setItem(key, JSON.stringify(stored))
  } catch {
    // 存储写满等异常不阻断交易流程
  }
}

export const loadSelectedSymbol = (key: string = SYMBOL_STORAGE_KEY): (SymbolRef & { name?: string }) | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) {
      return null
    }
    const parsed = JSON.parse(raw) as SymbolRef & { name?: string }
    if (typeof parsed?.market !== 'string' || typeof parsed?.ticker !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export const saveSelectedSymbol = (symbol: SymbolRef & { name?: string }, key: string = SYMBOL_STORAGE_KEY): void => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(symbol))
  } catch {
    // 忽略持久化异常
  }
}

// ==================== 展示格式化 ====================

export const fmtMoney = (n: number): string =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtSignedMoney = (n: number): string => `${n > 0 ? '+' : ''}${fmtMoney(n)}`

export const fmtPct = (n: number): string => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
