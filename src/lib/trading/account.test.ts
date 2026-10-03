import { beforeEach, describe, expect, it } from 'vitest'
import {
  INITIAL_CASH,
  calcEquity,
  calcFees,
  createInitialAccount,
  dayKeyOf,
  executeBuy,
  executeSell,
  fillPriceOf,
  isTradableCode,
  limitPricesOf,
  limitRatioOf,
  loadAccount,
  loadSelectedSymbol,
  maxBuyQty,
  saveAccount,
  saveSelectedSymbol,
  unfreezePositions,
  validateOrder
} from './account'

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

describe('交易费用', () => {
  it('佣金按万 2.5 计且最低 5 元，买入无印花税', () => {
    // 大额：佣金 25 + 过户费 1
    expect(calcFees('buy', 100_000)).toBe(26)
    // 小额触发最低佣金 5 元
    expect(calcFees('buy', 1000)).toBe(5.01)
  })

  it('卖出加收印花税（万 5）', () => {
    // 佣金 25 + 过户费 1 + 印花税 50
    expect(calcFees('sell', 100_000)).toBe(76)
  })
})

describe('标的与涨跌停', () => {
  it('识别可交易个股前缀（排除指数/ETF）', () => {
    expect(isTradableCode('sh600519')).toBe(true)
    expect(isTradableCode('sh688981')).toBe(true)
    expect(isTradableCode('sz000001')).toBe(true)
    expect(isTradableCode('sz300750')).toBe(true)
    expect(isTradableCode('bj430047')).toBe(true)
    expect(isTradableCode('sh000001')).toBe(false)
    expect(isTradableCode('sz399001')).toBe(false)
    expect(isTradableCode('sh510300')).toBe(false)
  })

  it('按板块返回涨跌幅限制', () => {
    expect(limitRatioOf('sh600519')).toBe(0.1)
    expect(limitRatioOf('sz000001')).toBe(0.1)
    expect(limitRatioOf('sh688981')).toBe(0.2)
    expect(limitRatioOf('sz300750')).toBe(0.2)
    expect(limitRatioOf('bj430047')).toBe(0.3)
  })

  it('涨跌停价按昨收计算并保留两位', () => {
    expect(limitPricesOf(10, 'sh600519')).toEqual({ upper: 11, lower: 9 })
    expect(limitPricesOf(33.33, 'sh600519')).toEqual({ upper: 36.66, lower: 30 })
  })
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
      validateOrder({ account, side: 'sell', code: 'sh600519', price: 100, qty: 100, prevClose: null })?.message
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

describe('下单校验', () => {
  it('指数不可交易', () => {
    expect(
      validateOrder({
        account: createInitialAccount(DAY1),
        side: 'buy',
        code: 'sh000001',
        price: 3000,
        qty: 100,
        prevClose: null
      })
    ).toMatchObject({ code: 'not_tradable', message: expect.stringContaining('不支持模拟交易') })
  })

  it('涨跌停边界校验', () => {
    const account = createInitialAccount(DAY1)
    const input = { account, side: 'buy' as const, code: 'sh600519', qty: 100, prevClose: 100 }
    expect(validateOrder({ ...input, price: 110.01 })).toMatchObject({
      code: 'price_limit',
      message: expect.stringContaining('涨跌停')
    })
    expect(validateOrder({ ...input, price: 89.99 })).toMatchObject({ code: 'price_limit' })
    expect(validateOrder({ ...input, price: 110 })).toBeNull()
    expect(validateOrder({ ...input, price: 90 })).toBeNull()
  })

  it('买入整手与资金校验', () => {
    const account = createInitialAccount(DAY1)
    expect(
      validateOrder({ account, side: 'buy', code: 'sh600519', price: 100, qty: 150, prevClose: null })?.message
    ).toContain('100 股')
    expect(
      validateOrder({ account, side: 'buy', code: 'sh600519', price: 9999, qty: 100, prevClose: null })?.message
    ).toContain('资金不足')
    expect(
      validateOrder({ account, side: 'buy', code: 'sh600519', price: 100, qty: -100, prevClose: null })
    ).toMatchObject({ code: 'invalid_qty' })
    expect(validateOrder({ account, side: 'buy', code: 'sh600519', price: 100, qty: 100, prevClose: null })).toBeNull()
  })

  it('现价成交：委托价劣于现价不能成交（买 < 现价 / 卖 > 现价），等于现价可成交', () => {
    const buy = {
      account: createInitialAccount(DAY1),
      side: 'buy' as const,
      code: 'sh600519',
      qty: 100,
      prevClose: null,
      lastPrice: 110
    }
    expect(validateOrder({ ...buy, price: 109.99 })).toMatchObject({ code: 'price_unfillable' })
    expect(validateOrder({ ...buy, price: 110 })).toBeNull()
    expect(validateOrder({ ...buy, price: 110.01 })).toBeNull()

    const held = unfreezePositions(
      executeBuy(createInitialAccount(DAY1), order({ price: 100, qty: 100 })),
      dayKeyOf(DAY2)
    )
    const sell = { account: held, side: 'sell' as const, code: 'sh600519', qty: 100, prevClose: null, lastPrice: 100 }
    expect(validateOrder({ ...sell, price: 100.01 })).toMatchObject({ code: 'price_unfillable' })
    expect(validateOrder({ ...sell, price: 100 })).toBeNull()
    expect(validateOrder({ ...sell, price: 99.9 })).toBeNull()
  })

  it('缺现价时跳过可成交校验（按委托价成交）', () => {
    expect(
      validateOrder({
        account: createInitialAccount(DAY1),
        side: 'buy',
        code: 'sh600519',
        price: 90,
        qty: 100,
        prevClose: null,
        lastPrice: null
      })
    ).toBeNull()
  })

  it('fillPriceOf：有现价按现价成交，缺行情回退委托价', () => {
    expect(fillPriceOf(105, 100)).toBe(100)
    expect(fillPriceOf(95, 100)).toBe(100)
    expect(fillPriceOf(105, null)).toBe(105)
    expect(fillPriceOf(105, 0)).toBe(105)
  })

  it('最大可买为整手且费用后不超资金', () => {
    const cash = 10_000
    const qty = maxBuyQty(cash, 10)
    expect(qty % 100).toBe(0)
    const amount = round(qty * 10)
    expect(amount).toBeGreaterThan(0)
    expect(amount + calcFees('buy', amount)).toBeLessThanOrEqual(cash)
    expect(maxBuyQty(50, 10)).toBe(0)
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
