import { describe, expect, it } from 'vitest'
import { INITIAL_CASH, createInitialAccount, dayKeyOf, executeBuy, unfreezePositions } from './account'
import { applyPlaceOrder, applyTradeEvent, type MarketContext } from './events'
import type { TradingAccount } from './account'

// 2024-06-03（周一）与次日，本地时区内的固定时间戳
const DAY1 = new Date(2024, 5, 3, 10, 0, 0).getTime()
const DAY2 = new Date(2024, 5, 4, 10, 0, 0).getTime()

/** 默认行情快照：昨收 100、现价 100（涨停 110 / 跌停 90） */
const market = (overrides: Partial<MarketContext> = {}): MarketContext => ({
  prevClose: 100,
  lastPrice: 100,
  ...overrides
})

const buyEvent = {
  type: 'place_order' as const,
  side: 'buy' as const,
  code: 'sh600519',
  name: '贵州茅台',
  price: 100,
  qty: 100,
  ts: DAY1
}

/** 200 股持仓（当日买入，T+1 次日可卖） */
const bought200 = (): TradingAccount =>
  executeBuy(createInitialAccount(DAY1), {
    code: 'sh600519',
    name: '贵州茅台',
    price: 100,
    qty: 200,
    ts: DAY1
  })

describe('事件引擎：select_side（切换买卖）', () => {
  it('买侧建议 = 现价最大可买整手（扣预估费用）', () => {
    const account: TradingAccount = { ...createInitialAccount(DAY1), cash: 10_000 }
    const outcome = applyTradeEvent(
      account,
      { type: 'select_side', side: 'buy', code: 'sh600519' },
      market({ lastPrice: 10 })
    )
    expect(outcome).toEqual({ kind: 'side_selected', side: 'buy', suggestedQty: 900 })
  })

  it('缺现价时买侧建议为 0', () => {
    const outcome = applyTradeEvent(
      createInitialAccount(DAY1),
      { type: 'select_side', side: 'buy', code: 'sh600519' },
      market({ lastPrice: null })
    )
    expect(outcome).toEqual({ kind: 'side_selected', side: 'buy', suggestedQty: 0 })
  })

  it('卖侧建议 = 该标的可卖数量（当日买入 T+1 冻结为 0，次日解冻为持仓量）', () => {
    const bought = executeBuy(createInitialAccount(DAY1), {
      code: 'sh600519',
      name: '贵州茅台',
      price: 100,
      qty: 200,
      ts: DAY1
    })
    expect(applyTradeEvent(bought, { type: 'select_side', side: 'sell', code: 'sh600519' }, market())).toEqual({
      kind: 'side_selected',
      side: 'sell',
      suggestedQty: 0
    })

    const unfrozen = unfreezePositions(bought, dayKeyOf(DAY2))
    expect(applyTradeEvent(unfrozen, { type: 'select_side', side: 'sell', code: 'sh600519' }, market())).toEqual({
      kind: 'side_selected',
      side: 'sell',
      suggestedQty: 200
    })
  })

  it('比例仓（frac）：买侧数量按最大可买 × 比例取整手，基数变化重派同比例即联动', () => {
    const account: TradingAccount = { ...createInitialAccount(DAY1), cash: 10_000 }
    // 基数 900 股（现价 10）：1/2 = 400、1/3 = 300、1/4 = 200、全仓 = 900
    expect(
      applyTradeEvent(
        account,
        { type: 'select_side', side: 'buy', code: 'sh600519', frac: 1 / 2 },
        market({ lastPrice: 10 })
      )
    ).toEqual({ kind: 'side_selected', side: 'buy', suggestedQty: 400 })
    expect(
      applyTradeEvent(
        account,
        { type: 'select_side', side: 'buy', code: 'sh600519', frac: 1 / 3 },
        market({ lastPrice: 10 })
      )
    ).toEqual({ kind: 'side_selected', side: 'buy', suggestedQty: 300 })
    expect(
      applyTradeEvent(
        account,
        { type: 'select_side', side: 'buy', code: 'sh600519', frac: 1 / 4 },
        market({ lastPrice: 10 })
      )
    ).toEqual({ kind: 'side_selected', side: 'buy', suggestedQty: 200 })
    // 行情变化基数 1900 股（现价 5）：同比例 1/2 联动为 900
    expect(
      applyTradeEvent(
        account,
        { type: 'select_side', side: 'buy', code: 'sh600519', frac: 1 / 2 },
        market({ lastPrice: 5 })
      )
    ).toEqual({ kind: 'side_selected', side: 'buy', suggestedQty: 900 })
  })

  it('比例仓卖侧：按可卖数量 × 比例取整手，全仓保留零股', () => {
    const unfrozen = unfreezePositions(bought200(), dayKeyOf(DAY2))
    expect(
      applyTradeEvent(unfrozen, { type: 'select_side', side: 'sell', code: 'sh600519', frac: 1 / 2 }, market())
    ).toEqual({ kind: 'side_selected', side: 'sell', suggestedQty: 100 })
    expect(
      applyTradeEvent(unfrozen, { type: 'select_side', side: 'sell', code: 'sh600519', frac: 1 }, market())
    ).toEqual({ kind: 'side_selected', side: 'sell', suggestedQty: 200 })
  })

  it('无持仓标的卖侧建议为 0', () => {
    expect(
      applyTradeEvent(createInitialAccount(DAY1), { type: 'select_side', side: 'sell', code: 'sz000001' }, market())
    ).toEqual({ kind: 'side_selected', side: 'sell', suggestedQty: 0 })
  })

  it('委托价 orderPrice 作为买侧建议基准（委托价变化数量联动），缺省回退现价', () => {
    const account: TradingAccount = { ...createInitialAccount(DAY1), cash: 10_000 }
    // 现价 10 基准 → 900 股；委托价 5 基准 → 1900 股
    expect(
      applyTradeEvent(account, { type: 'select_side', side: 'buy', code: 'sh600519' }, market({ orderPrice: 5 }))
    ).toEqual({ kind: 'side_selected', side: 'buy', suggestedQty: 1900 })
    // orderPrice 缺省回退现价
    expect(
      applyTradeEvent(account, { type: 'select_side', side: 'buy', code: 'sh600519' }, market({ lastPrice: 10 }))
    ).toEqual({ kind: 'side_selected', side: 'buy', suggestedQty: 900 })
    // orderPrice 非正 → 建议 0
    expect(
      applyTradeEvent(account, { type: 'select_side', side: 'buy', code: 'sh600519' }, market({ orderPrice: 0 }))
    ).toEqual({ kind: 'side_selected', side: 'buy', suggestedQty: 0 })
  })
})

describe('事件引擎：init_order（初始化委托）', () => {
  it('默认填入买侧最大可买整手（扣预估费用），结果 kind 区分初始化', () => {
    const account: TradingAccount = { ...createInitialAccount(DAY1), cash: 10_000 }
    const outcome = applyTradeEvent(
      account,
      { type: 'init_order', side: 'buy', code: 'sh600519' },
      market({ lastPrice: 10 })
    )
    expect(outcome).toEqual({ kind: 'order_initialized', side: 'buy', suggestedQty: 900 })
  })

  it('缺现价（行情未到）建议为 0，UI 保持空输入', () => {
    const outcome = applyTradeEvent(
      createInitialAccount(DAY1),
      { type: 'init_order', side: 'buy', code: 'sh600519' },
      market({ lastPrice: null })
    )
    expect(outcome).toEqual({ kind: 'order_initialized', side: 'buy', suggestedQty: 0 })
  })

  it('卖侧初始化 = 该标的可卖数量（T+1 冻结为 0，次日为持仓量；无持仓 0）', () => {
    const bought = bought200()
    expect(applyTradeEvent(bought, { type: 'init_order', side: 'sell', code: 'sh600519' }, market())).toEqual({
      kind: 'order_initialized',
      side: 'sell',
      suggestedQty: 0
    })
    expect(
      applyTradeEvent(
        unfreezePositions(bought, dayKeyOf(DAY2)),
        { type: 'init_order', side: 'sell', code: 'sh600519' },
        market()
      )
    ).toEqual({ kind: 'order_initialized', side: 'sell', suggestedQty: 200 })
    expect(
      applyTradeEvent(createInitialAccount(DAY1), { type: 'init_order', side: 'sell', code: 'sz000001' }, market())
    ).toEqual({ kind: 'order_initialized', side: 'sell', suggestedQty: 0 })
  })
})

describe('事件引擎：place_order 买入', () => {
  it('通过校验 → 按现价成交并落账（现金/冻结/成交记录）', () => {
    // 委托 106 ≥ 现价 105 可成交；成交价一律按现价（优于现价的部分让渡给对手方）
    const outcome = applyTradeEvent(createInitialAccount(DAY1), { ...buyEvent, price: 106 }, market({ lastPrice: 105 }))
    expect(outcome.kind).toBe('executed')
    if (outcome.kind !== 'executed') {
      return
    }
    expect(outcome.price).toBe(105)
    const position = outcome.account.positions[0]
    expect(position.qty).toBe(100)
    expect(position.availableQty).toBe(0)
    expect(position.frozenQty).toBe(100)
    expect(outcome.account.trades[0]).toMatchObject({ side: 'buy', price: 105, qty: 100 })
  })

  it('缺行情回退委托价成交', () => {
    const outcome = applyTradeEvent(createInitialAccount(DAY1), buyEvent, market({ prevClose: null, lastPrice: null }))
    expect(outcome).toMatchObject({ kind: 'executed', price: 100 })
  })

  it('规则拒绝原样透传（code + 双语文案）', () => {
    const cases: Array<[Partial<typeof buyEvent>, Partial<MarketContext>, string]> = [
      [{ qty: 150 }, {}, 'lot_size'],
      [{ price: 9999 }, { prevClose: null }, 'insufficient_cash'],
      [{ price: 110.01 }, {}, 'price_limit'],
      [{ price: 95 }, { lastPrice: 100 }, 'price_unfillable'],
      [{ code: 'sh000001' }, {}, 'not_tradable']
    ]
    for (const [eventOverride, marketOverride, code] of cases) {
      const outcome = applyTradeEvent(
        createInitialAccount(DAY1),
        { ...buyEvent, ...eventOverride },
        market(marketOverride)
      )
      expect(outcome).toMatchObject({ kind: 'rejected', rejection: { code, message: expect.stringContaining('|') } })
    }
  })
})

describe('事件引擎：place_order 卖出', () => {
  const bought = executeBuy(createInitialAccount(DAY1), {
    code: 'sh600519',
    name: '贵州茅台',
    price: 100,
    qty: 200,
    ts: DAY1
  })
  const sellEvent = {
    type: 'place_order' as const,
    side: 'sell' as const,
    code: 'sh600519',
    price: 100,
    qty: 100,
    ts: DAY2
  }

  it('当日买入 T+1 不可卖 → 拒绝（卖出事件与买入同日）', () => {
    // 卖单时间戳 = 买入同日（2024-06-03）下午，冻结未跨日不解冻
    const sameDayTs = new Date(2024, 5, 3, 14, 0, 0).getTime()
    const outcome = applyTradeEvent(bought, { ...sellEvent, ts: sameDayTs }, market())
    expect(outcome).toMatchObject({
      kind: 'rejected',
      rejection: { code: 'insufficient_qty', message: expect.stringContaining('T+1') }
    })
  })

  it('次日解冻后可卖，落袋已实现盈亏；卖出允许零股', () => {
    const outcome = applyTradeEvent(unfreezePositions(bought, dayKeyOf(DAY2)), sellEvent, market({ lastPrice: 110 }))
    expect(outcome.kind).toBe('executed')
    if (outcome.kind !== 'executed') {
      return
    }
    expect(outcome.price).toBe(110)
    expect(outcome.account.trades[0].realizedPnl).not.toBeNull()
    expect(outcome.account.positions[0]).toMatchObject({ qty: 100, availableQty: 100 })

    const partial = applyTradeEvent(outcome.account, { ...sellEvent, qty: 43 }, market())
    expect(partial).toMatchObject({ kind: 'executed' })
  })

  it('清仓后移除持仓', () => {
    const outcome = applyTradeEvent(unfreezePositions(bought, dayKeyOf(DAY2)), { ...sellEvent, qty: 200 }, market())
    expect(outcome).toMatchObject({ kind: 'executed' })
    if (outcome.kind !== 'executed') {
      return
    }
    expect(outcome.account.positions).toHaveLength(0)
    expect(outcome.account.cash).toBeLessThan(INITIAL_CASH) // 扣除双边费用
  })
})

describe('事件引擎：纯函数与两端共用', () => {
  it('不修改入参账户（变更只体现在返回值）', () => {
    const account = createInitialAccount(DAY1)
    const snapshot = JSON.stringify(account)
    applyTradeEvent(account, buyEvent, market())
    applyTradeEvent(account, { type: 'select_side', side: 'sell', code: 'sh600519' }, market())
    expect(JSON.stringify(account)).toBe(snapshot)
  })

  it('applyTradeEvent 对 place_order 与 applyPlaceOrder 结果一致（客户端/服务端同一管线）', () => {
    const account = unfreezePositions(bought200(), dayKeyOf(DAY2))
    const sell = { type: 'place_order' as const, side: 'sell' as const, code: 'sh600519', price: 99, qty: 50, ts: DAY2 }
    // 成交记录 id 含随机段，比较前剔除
    const stripId = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value, (k, v) => (k === 'id' ? undefined : v)))
    expect(stripId(applyTradeEvent(account, sell, market()))).toEqual(stripId(applyPlaceOrder(account, sell, market())))
  })

  it('name 缺省沿用持仓名', () => {
    const outcome = applyTradeEvent(
      unfreezePositions(bought200(), dayKeyOf(DAY2)),
      { type: 'place_order', side: 'sell', code: 'sh600519', price: 100, qty: 50, ts: DAY2 },
      market()
    )
    expect(outcome).toMatchObject({ kind: 'executed' })
    if (outcome.kind !== 'executed') {
      return
    }
    expect(outcome.account.trades[0].name).toBe('贵州茅台')
    expect(outcome.account.positions[0].name).toBe('贵州茅台')
  })
})
