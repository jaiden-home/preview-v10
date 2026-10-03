import { describe, expect, it } from 'vitest'
import {
  LOT_SIZE,
  calcFees,
  fillPriceOf,
  fractionQtyOf,
  isTradableCode,
  limitPricesOf,
  limitRatioOf,
  maxBuyQty,
  round2,
  validateOrder
} from './rules'

/** 校验输入构造器：默认通过校验的买入单（现金充足、无持仓），按用例覆写 */
const order = (overrides: Partial<Parameters<typeof validateOrder>[0]> = {}) => ({
  cash: 1_000_000,
  availableQty: {},
  side: 'buy' as const,
  code: 'sh600519',
  price: 100,
  qty: 100,
  prevClose: null,
  lastPrice: null,
  ...overrides
})

describe('round2', () => {
  it('四舍五入保留两位', () => {
    expect(round2(2.675)).toBe(2.68)
    expect(round2(1.234)).toBe(1.23)
    expect(round2(1.236)).toBe(1.24)
    expect(round2(-1.005)).toBe(-1)
    expect(round2(3)).toBe(3)
  })
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

  it('非正金额不计费', () => {
    expect(calcFees('buy', 0)).toBe(0)
    expect(calcFees('sell', -100)).toBe(0)
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
    expect(isTradableCode('hk00700')).toBe(false)
    expect(isTradableCode('')).toBe(false)
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
    // 创业板 ±20%
    expect(limitPricesOf(10, 'sz300750')).toEqual({ upper: 12, lower: 8 })
  })
})

describe('比例仓数量', () => {
  it('全仓原样（卖出可含零股），非全仓向下取整手', () => {
    expect(fractionQtyOf(250, 1)).toBe(250)
    expect(fractionQtyOf(900, 1)).toBe(900)
    expect(fractionQtyOf(900, 1 / 2)).toBe(400)
    // 900 × 1/3 = 299.99…（浮点尾巴）仍应为 300 而非 200
    expect(fractionQtyOf(900, 1 / 3)).toBe(300)
    expect(fractionQtyOf(900, 1 / 4)).toBe(200)
    expect(fractionQtyOf(250, 1 / 2)).toBe(100)
    expect(fractionQtyOf(0, 1 / 2)).toBe(0)
  })
})

describe('下单校验：标的与价格', () => {
  it('指数不可交易', () => {
    expect(validateOrder(order({ code: 'sh000001' }))).toMatchObject({
      code: 'not_tradable',
      message: expect.stringContaining('不支持模拟交易')
    })
  })

  it('价格非法（非有限数/零/负数）拒绝', () => {
    expect(validateOrder(order({ price: Number.NaN }))).toMatchObject({ code: 'invalid_price' })
    expect(validateOrder(order({ price: 0 }))).toMatchObject({ code: 'invalid_price' })
    expect(validateOrder(order({ price: -1 }))).toMatchObject({ code: 'invalid_price' })
  })

  it('涨跌停边界：界内（含界）通过、界外拒绝', () => {
    expect(validateOrder(order({ price: 110.01, prevClose: 100 }))).toMatchObject({
      code: 'price_limit',
      message: expect.stringContaining('涨跌停')
    })
    expect(validateOrder(order({ price: 89.99, prevClose: 100 }))).toMatchObject({ code: 'price_limit' })
    expect(validateOrder(order({ price: 110, prevClose: 100 }))).toBeNull()
    expect(validateOrder(order({ price: 90, prevClose: 100 }))).toBeNull()
  })

  it('涨跌停按板块比例（创业板 ±20%）', () => {
    expect(validateOrder(order({ code: 'sz300750', price: 120, prevClose: 100 }))).toBeNull()
    expect(validateOrder(order({ code: 'sz300750', price: 120.01, prevClose: 100 }))).toMatchObject({
      code: 'price_limit'
    })
  })

  it('缺昨收（null/非正数）跳过涨跌停校验', () => {
    expect(validateOrder(order({ price: 999_999, prevClose: null }))).toMatchObject({ code: 'insufficient_cash' })
    expect(validateOrder(order({ price: 999_999, prevClose: 0 }))).toMatchObject({ code: 'insufficient_cash' })
  })
})

describe('下单校验：现价成交', () => {
  it('买入委托价低于现价不能成交，等于/高于现价可成交', () => {
    expect(validateOrder(order({ price: 109.99, lastPrice: 110 }))).toMatchObject({ code: 'price_unfillable' })
    expect(validateOrder(order({ price: 110, lastPrice: 110 }))).toBeNull()
    expect(validateOrder(order({ price: 110.01, lastPrice: 110 }))).toBeNull()
  })

  it('卖出委托价高于现价不能成交，等于/低于现价可成交', () => {
    const held = { availableQty: { sh600519: 100 } }
    expect(validateOrder(order({ ...held, side: 'sell', price: 100.01, lastPrice: 100 }))).toMatchObject({
      code: 'price_unfillable'
    })
    expect(validateOrder(order({ ...held, side: 'sell', price: 100, lastPrice: 100 }))).toBeNull()
    expect(validateOrder(order({ ...held, side: 'sell', price: 99.9, lastPrice: 100 }))).toBeNull()
  })

  it('现价比较按分位取整：浮点尾巴/亚分位现价不误拒同价委托', () => {
    const held = { availableQty: { sh600519: 100 } }
    // 复现：显示现价 18.73（toFixed(2)），实际行情值带浮点尾巴 18.72999…，
    // 委托 18.73 曾被判"高于现价"拒单；取整后同价应通过
    expect(validateOrder(order({ ...held, side: 'sell', price: 18.73, lastPrice: 18.729999999999997 }))).toBeNull()
    // 亚分位现价 18.725（显示 18.73）：委托 18.73 通过，委托 18.74 拒
    expect(validateOrder(order({ ...held, side: 'sell', price: 18.73, lastPrice: 18.725 }))).toBeNull()
    expect(validateOrder(order({ ...held, side: 'sell', price: 18.74, lastPrice: 18.725 }))).toMatchObject({
      code: 'price_unfillable'
    })
    // 买入侧对称：现价 18.730000000000004（显示 18.73），委托 18.73 通过
    expect(validateOrder(order({ price: 18.73, lastPrice: 18.730000000000004 }))).toBeNull()
  })

  it('缺现价（null/非正数）跳过可成交校验（按委托价成交）', () => {
    expect(validateOrder(order({ price: 90, lastPrice: null }))).toBeNull()
    expect(validateOrder(order({ price: 90, lastPrice: 0 }))).toBeNull()
  })
})

describe('下单校验：数量与账户上下文', () => {
  it('数量非法（非整数/零/负数）拒绝', () => {
    expect(validateOrder(order({ qty: 100.5 }))).toMatchObject({ code: 'invalid_qty' })
    expect(validateOrder(order({ qty: 0 }))).toMatchObject({ code: 'invalid_qty' })
    expect(validateOrder(order({ qty: -100 }))).toMatchObject({ code: 'invalid_qty' })
  })

  it('买入须为整手（100 股整数倍）', () => {
    expect(validateOrder(order({ qty: 150 }))).toMatchObject({ code: 'lot_size' })
    expect(validateOrder(order({ qty: LOT_SIZE }))).toBeNull()
  })

  it('买入资金校验含预估费用，恰好够款可通过', () => {
    // 100 元 × 100 股 = 10000 元，费用 5.1 元
    const total = 10_000 + calcFees('buy', 10_000)
    expect(validateOrder(order({ cash: total - 1 }))).toMatchObject({ code: 'insufficient_cash' })
    expect(validateOrder(order({ cash: total }))).toBeNull()
  })

  it('卖出校验可卖数量（无持仓/不足拒绝，恰好可卖通过）', () => {
    expect(validateOrder(order({ side: 'sell', qty: 100 }))).toMatchObject({
      code: 'insufficient_qty',
      message: expect.stringContaining('T+1')
    })
    expect(validateOrder(order({ side: 'sell', qty: 100, availableQty: { sh600519: 100 } }))).toBeNull()
    expect(validateOrder(order({ side: 'sell', qty: 200, availableQty: { sh600519: 100 } }))).toMatchObject({
      code: 'insufficient_qty'
    })
  })

  it('卖出不做整手与资金校验（零股可清仓）', () => {
    expect(validateOrder(order({ side: 'sell', qty: 57, availableQty: { sh600519: 57 }, cash: 0 }))).toBeNull()
  })
})

describe('成交价', () => {
  it('fillPriceOf：有现价按现价成交（分位取整），缺行情回退委托价', () => {
    expect(fillPriceOf(105, 100)).toBe(100)
    expect(fillPriceOf(95, 100)).toBe(100)
    expect(fillPriceOf(105, 18.729999999999997)).toBe(18.73)
    expect(fillPriceOf(105, null)).toBe(105)
    expect(fillPriceOf(105, 0)).toBe(105)
  })
})

describe('最大可买', () => {
  it('为整手且费用后不超资金', () => {
    const cash = 10_000
    const qty = maxBuyQty(cash, 10)
    expect(qty % 100).toBe(0)
    const amount = round2(qty * 10)
    expect(amount).toBeGreaterThan(0)
    expect(amount + calcFees('buy', amount)).toBeLessThanOrEqual(cash)
  })

  it('资金不足一手或价格非正返回 0', () => {
    expect(maxBuyQty(50, 10)).toBe(0)
    expect(maxBuyQty(10_000, 0)).toBe(0)
    expect(maxBuyQty(10_000, -1)).toBe(0)
  })

  it('费用导致裸资金差一手时自动降一手', () => {
    // 10000 元恰好 100 股 × 100 元，但费用 5.1 元超限 → 降为 0
    expect(maxBuyQty(10_000, 100)).toBe(0)
    // 加上费用后刚好够
    expect(maxBuyQty(10_000 + 5.1, 100)).toBe(100)
  })
})
