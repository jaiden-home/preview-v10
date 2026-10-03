import { beforeEach, describe, expect, it } from 'vitest'
import {
  INITIAL_CASH,
  calcEquity,
  createInitialAccount,
  dayKeyOf,
  executeBuy,
  executeSell,
  loadAccount,
  loadSelectedSymbol,
  orderContextOf,
  saveAccount,
  saveSelectedSymbol,
  unfreezePositions
} from './account'
import { calcFees, validateOrder } from './rules'

// 2024-06-03（周一）与次日，本地时区内的固定时间戳
const DAY1 = new Date(2024, 5, 3, 10, 0, 0).getTime()
const DAY2 = new Date(2024, 5, 4, 10, 0, 0).getTime()

const order = (overrides: Partial<Parameters<typeof executeBuy>[1]> = {}) => ({
  code: 'sh600519',
  name: '贵州茅台',
  price: 100,
  qty: 100,
  ts: DAY1,
  ...overrides
})

describe('买入执行', () => {
  it('新开仓：冻结 T+1、成本含费用、现金扣减金额加费用', () => {
    const account = executeBuy(createInitialAccount(DAY1), order({ price: 100, qty: 200 }))
    const position = account.positions[0]
    expect(position.qty).toBe(200)
    expect(position.availableQty).toBe(0)
    expect(position.frozenQty).toBe(200)
    expect(position.frozenDate).toBe(dayKeyOf(DAY1))
    // 成本 = (20000 + 5.2) / 200
    expect(position.costPrice).toBe(100.03)

    const amount = 20_000
    const fee = calcFees('buy', amount)
    expect(account.cash).toBe(round(INITIAL_CASH - amount - fee))
    expect(account.trades).toHaveLength(1)
    expect(account.trades[0]).toMatchObject({ side: 'buy', price: 100, qty: 200, amount, fee })
    // 成交记录只记日期：ts 截断至当日零点，不含时分秒
    expect(account.trades[0].ts).toBe(new Date(2024, 5, 3).getTime())
  })

  it('同日加仓：摊薄成本与冻结累加', () => {
    let account = executeBuy(createInitialAccount(DAY1), order({ price: 100, qty: 100 }))
    account = executeBuy(account, order({ price: 200, qty: 100 }))
    const position = account.positions[0]
    expect(position.qty).toBe(200)
    expect(position.frozenQty).toBe(200)
    expect(position.availableQty).toBe(0)
    // 成本 = (100*100 + 20000 + 费用) / 200
    const fees = calcFees('buy', 10_000) + calcFees('buy', 20_000)
    expect(position.costPrice).toBe(round((10_000 + 20_000 + fees) / 200))
  })

  it('非整手或资金不足直接抛错（正常流应先 validateOrder）', () => {
    expect(() => executeBuy(createInitialAccount(DAY1), order({ qty: 150 }))).toThrow(/invalid buy order/)
    expect(() => executeBuy(createInitialAccount(DAY1), order({ price: 1_000_000, qty: 100 }))).toThrow(
      /insufficient cash/
    )
  })
})

describe('T+1 与卖出执行', () => {
  it('当日买入不可卖，次日解冻后可卖', () => {
    let account = executeBuy(createInitialAccount(DAY1), order({ price: 100, qty: 200 }))
    expect(
      validateOrder({
        ...orderContextOf(account),
        side: 'sell',
        code: 'sh600519',
        price: 100,
        qty: 100,
        prevClose: null
      })?.message
    ).toContain('T+1')

    const unfrozen = unfreezePositions(account, dayKeyOf(DAY2))
    expect(unfrozen.positions[0].availableQty).toBe(200)
    expect(unfrozen.positions[0].frozenQty).toBe(0)

    account = executeSell(unfrozen, order({ price: 110, qty: 100, ts: DAY2 }))
    const position = account.positions[0]
    expect(position.qty).toBe(100)
    expect(position.availableQty).toBe(100)
    // 已实现盈亏 = (110 - 100.03) * 100 - 卖出费用
    const amount = 11_000
    const fee = calcFees('sell', amount)
    expect(account.trades[0].realizedPnl).toBe(round((110 - 100.03) * 100 - fee))
    expect(account.cash).toBe(round(INITIAL_CASH - 20_000 - calcFees('buy', 20_000) + amount - fee))
  })

  it('卖出允许零股清仓，清仓后移除持仓', () => {
    let account = executeBuy(createInitialAccount(DAY1), order({ price: 100, qty: 300 }))
    account = executeSell(unfreezePositions(account, dayKeyOf(DAY2)), order({ price: 100, qty: 300, ts: DAY2 }))
    expect(account.positions).toHaveLength(0)
  })

  it('超可卖数量抛错', () => {
    const account = executeBuy(createInitialAccount(DAY1), order({ price: 100, qty: 100 }))
    expect(() =>
      executeSell(unfreezePositions(account, dayKeyOf(DAY2)), order({ price: 100, qty: 200, ts: DAY2 }))
    ).toThrow(/insufficient available qty/)
  })
})

describe('下单校验上下文', () => {
  it('orderContextOf 投影可用现金与各标的可卖数量（T+1 可卖）', () => {
    const account = unfreezePositions(
      executeBuy(createInitialAccount(DAY1), order({ price: 100, qty: 100 })),
      dayKeyOf(DAY2)
    )
    expect(orderContextOf(account)).toEqual({
      cash: account.cash,
      availableQty: { sh600519: 100 }
    })
  })
})

describe('权益计算', () => {
  it('市值/总资产/盈亏口径正确，缺价回退成本', () => {
    let account = executeBuy(createInitialAccount(DAY1), order({ price: 100, qty: 100 }))

    // 无现价：按摊薄成本价估值，浮动盈亏为 0
    let equity = calcEquity(account, {})
    expect(equity.marketValue).toBe(round(account.positions[0].costPrice * 100))
    expect(equity.positionPnl).toBe(0)
    expect(equity.totalAssets).toBe(round(account.cash + equity.marketValue))

    // 现价 110：浮盈 ≈ (110 - 成本) * 100
    equity = calcEquity(account, { sh600519: 110 })
    expect(equity.positionPnl).toBe(round((110 - account.positions[0].costPrice) * 100))
    expect(equity.totalPnl).toBe(round(equity.totalAssets - INITIAL_CASH))
    expect(equity.dayPnl).toBe(round(equity.totalAssets - INITIAL_CASH))

    account = executeSell(unfreezePositions(account, dayKeyOf(DAY2)), order({ price: 110, qty: 100, ts: DAY2 }))
    equity = calcEquity(account, {})
    expect(equity.positionPnl).toBe(0)
    expect(equity.marketValue).toBe(0)
  })
})

describe('持久化', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('账户读写往返，读取时自动 T+1 解冻', () => {
    const account = executeBuy(createInitialAccount(DAY1), order({ price: 100, qty: 100 }))
    saveAccount(account)
    const loaded = loadAccount()
    expect(loaded).not.toBeNull()
    expect(loaded?.positions[0].availableQty).toBe(100)
    expect(loaded?.trades).toHaveLength(1)
  })

  it('损坏数据回退 null，不阻断页面', () => {
    window.localStorage.setItem('klinecharts-paper-account', '{oops')
    expect(loadAccount()).toBeNull()
    window.localStorage.setItem('klinecharts-paper-account', JSON.stringify({ version: 99 }))
    expect(loadAccount()).toBeNull()
  })

  it('记住上一次选择的标的', () => {
    expect(loadSelectedSymbol()).toBeNull()
    saveSelectedSymbol({ market: 'sz', ticker: '000001', name: '平安银行' })
    expect(loadSelectedSymbol()).toEqual({ market: 'sz', ticker: '000001', name: '平安银行' })
  })
})

const round = (n: number): number => Math.round(n * 100) / 100
