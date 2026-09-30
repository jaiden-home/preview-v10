import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { createInitialAccount, executeBuy } from '@/lib/trading/account'
import type { SimSession } from '@/lib/trading/protocol'
import { SimTradingError } from './contract'
import {
  applySessionControl,
  closePricesAt,
  placeOrderEngine,
  replayViewOf,
  settleSim,
  startSessionEngine,
  type MarketSource
} from './engine'

// 固定行情：2024-06-03（周一）起 5 个交易日，收盘 100/110/120/130/140
const makeBars = (closes: number[]): KLineData[] =>
  closes.map((close, i) => ({
    timestamp: new Date(2024, 5, 3 + i).getTime(),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000
  }))

const BARS = makeBars([100, 110, 120, 130, 140])

const replaySource: MarketSource = {
  replayBars: async (code) => (code === 'sh600519' ? BARS : []),
  liveQuote: async () => null
}

const liveSource: MarketSource = {
  replayBars: async () => [],
  liveQuote: async (code) => (code === 'sh600519' ? { name: '贵州茅台', price: 100, prevClose: 99 } : null)
}

const D1 = new Date(2024, 5, 3, 10, 0, 0).getTime()

const session = (overrides: Partial<SimSession> = {}): SimSession => ({
  status: 'running',
  speedMs: 10_000,
  anchorCode: 'sh600519',
  startDate: '2024-06-03',
  dayCount: 5,
  dayIndex: 1,
  lastTickAt: 1_000_000,
  ...overrides
})

describe('closePricesAt（跨日结算价格）', () => {
  const account = executeBuy(createInitialAccount(D1), {
    code: 'sh600519',
    name: '贵州茅台',
    price: 100,
    qty: 100,
    ts: D1
  })

  it('取虚拟日（含）之前最近一根收盘', () => {
    const prices = closePricesAt(account, new Map([['sh600519', BARS]]), '2024-06-04')
    expect(prices.sh600519).toBe(110)
  })

  it('停牌缺日沿用最近收盘，无数据回退成本价', () => {
    const partial = makeBars([100, 110, 120])
    expect(closePricesAt(account, new Map([['sh600519', partial]]), '2024-06-06').sh600519).toBe(120)
    expect(closePricesAt(account, new Map(), '2024-06-06').sh600519).toBe(account.positions[0]!.costPrice)
  })
})

describe('settleSim（跨日账务结算）', () => {
  it('推进虚拟日：T+1 解冻 + 当日基准滚动到最新虚拟日收盘', async () => {
    const account = executeBuy(createInitialAccount(D1), {
      code: 'sh600519',
      name: '贵州茅台',
      price: 100,
      qty: 100,
      ts: D1
    })
    const settled = await settleSim(account, session(), 1_000_000 + 10_000, replaySource)
    expect(settled.changed).toBe(true)
    expect(settled.session?.dayIndex).toBe(2)
    expect(settled.account.positions[0]!.availableQty).toBe(100)
    expect(settled.account.dayKey).toBe('2024-06-04')
    expect(settled.account.dayStartEquity).toBe(Math.round((account.cash + 110 * 100) * 100) / 100)
  })

  it('无会话或未推进时原样返回（changed=false）', async () => {
    const account = createInitialAccount(D1)
    expect((await settleSim(account, null, 9_999_999, replaySource)).changed).toBe(false)
    expect((await settleSim(account, session(), 1_000_000 + 100, replaySource)).changed).toBe(false)
  })
})

describe('placeOrderEngine（下单编排）', () => {
  it('live 下单：回放前收做涨跌停校验，虚拟日 15:00 成交', async () => {
    const exec = await placeOrderEngine(
      createInitialAccount(D1),
      session({ dayIndex: 2 }),
      { side: 'buy', code: 'sh600519', price: 110, qty: 100 },
      0,
      replaySource
    )
    expect(exec.account.positions[0]).toMatchObject({ code: 'sh600519', qty: 100, availableQty: 0 })
    // dayIndex=2 → 虚拟日 2024-06-04 15:00 成交（成交记录按口径截断至当日 00:00）
    expect(exec.account.trades[0]!.ts).toBe(new Date(2024, 5, 4, 0, 0, 0, 0).getTime())
  })

  it('超涨跌停拒单（price_limit）', async () => {
    await expect(
      placeOrderEngine(
        createInitialAccount(D1),
        session({ dayIndex: 2 }),
        { side: 'buy', code: 'sh600519', price: 130, qty: 100 },
        0,
        replaySource
      )
    ).rejects.toMatchObject({ simCode: 'price_limit' })
  })

  it('paused/ended 拒单（session_not_running）', async () => {
    for (const status of ['paused', 'ended'] as const) {
      await expect(
        placeOrderEngine(
          createInitialAccount(D1),
          session({ status }),
          { side: 'buy', code: 'sh600519', price: 100, qty: 100 },
          0,
          replaySource
        )
      ).rejects.toMatchObject({ simCode: 'session_not_running' })
    }
  })

  it('无会话拒单（no_active_session，不按实时行情成交）', async () => {
    const now = new Date(2024, 5, 3, 14, 30).getTime()
    await expect(
      placeOrderEngine(
        createInitialAccount(D1),
        null,
        { side: 'buy', code: 'sh600519', price: 100, qty: 100 },
        now,
        liveSource
      )
    ).rejects.toMatchObject({ simCode: 'no_active_session' })
  })
})

describe('startSessionEngine（开局编排）', () => {
  it('交易日不足 2 天拒绝开局', async () => {
    await expect(
      startSessionEngine(createInitialAccount(D1), { anchorCode: 'sh600519', startDate: '2024-06-07' }, 0, replaySource)
    ).rejects.toMatchObject({ simCode: 'insufficient_history' })
  })

  it('结束日（含）截断开局：dayCount = 区间交易日数', async () => {
    const started = await startSessionEngine(
      createInitialAccount(D1),
      { anchorCode: 'sh600519', startDate: '2024-06-03', endDate: '2024-06-05' },
      0,
      replaySource
    )
    expect(started.session).toMatchObject({ dayIndex: 1, dayCount: 3, status: 'running' })
  })

  it('开局即暂停：第 1 天完成但停住计时（paused）', async () => {
    const started = await startSessionEngine(
      createInitialAccount(D1),
      { anchorCode: 'sh600519', startDate: '2024-06-03', paused: true },
      0,
      replaySource
    )
    expect(started.session).toMatchObject({ dayIndex: 1, dayCount: 5, status: 'paused', lastTickAt: 0 })
  })

  it('开局带 speedMs：倍速档位换算生效（缺省 = 基准 1x）', async () => {
    const fast = await startSessionEngine(
      createInitialAccount(D1),
      { anchorCode: 'sh600519', startDate: '2024-06-03', speedMs: 2_000 },
      0,
      replaySource
    )
    expect(fast.session.speedMs).toBe(2_000)
    const base = await startSessionEngine(
      createInitialAccount(D1),
      { anchorCode: 'sh600519', startDate: '2024-06-03' },
      0,
      replaySource
    )
    expect(base.session.speedMs).toBe(10_000)
  })

  it('结束日早于起始日拒绝开局（区间为空）', async () => {
    await expect(
      startSessionEngine(
        createInitialAccount(D1),
        { anchorCode: 'sh600519', startDate: '2024-06-05', endDate: '2024-06-03' },
        0,
        replaySource
      )
    ).rejects.toMatchObject({ simCode: 'insufficient_history' })
  })

  it('开局：真实日期建仓视为历史持仓全部解冻，基准滚动到第 1 个虚拟日', async () => {
    // 用"未来"时间建仓，使账户 dayKey 晚于虚拟起点
    const realTs = new Date(2026, 0, 15, 10).getTime()
    const account = executeBuy(createInitialAccount(realTs), {
      code: 'sh600519',
      name: '贵州茅台',
      price: 100,
      qty: 100,
      ts: realTs
    })
    const started = await startSessionEngine(
      account,
      { anchorCode: 'sh600519', startDate: '2024-06-03' },
      5_000,
      replaySource
    )
    expect(started.session).toMatchObject({
      dayIndex: 1,
      dayCount: 5,
      speedMs: 10_000,
      status: 'running',
      lastTickAt: 5_000
    })
    expect(started.account.positions[0]!.availableQty).toBe(100)
    expect(started.account.dayKey).toBe('2024-06-03')
    expect(started.account.dayStartEquity).toBe(Math.round((account.cash + 100 * 100) * 100) / 100)
  })
})

describe('replayViewOf（回放视图，服务端算好）', () => {
  it('history = 起始日前历史；simDays = 模拟区间全量（按 dayCount 截止）', async () => {
    const view = await replayViewOf('sh600519', session(), replaySource)
    expect(view.code).toBe('sh600519')
    expect(view.name).toBeNull() // stub 的 replaySource liveQuote 恒 null
    expect(view.history).toEqual([]) // stub 数据自起始日起，无更早历史
    expect(view.simDays).toHaveLength(5) // dayCount=5：06-03..06-07
  })

  it('dayCount 超出数据时 simDays 为可得全量（数据尽头兜底）', async () => {
    const view = await replayViewOf('sh600519', session({ dayCount: 99 }), replaySource)
    expect(view.simDays).toHaveLength(5)
  })

  it('非锚定标的按锚定区间对齐切分；名称取实时行情', async () => {
    const view = await replayViewOf('sh600519', session(), liveSource) // liveSource：无日 K、有名称
    expect(view).toEqual({ code: 'sh600519', name: '贵州茅台', history: [], simDays: [] })
  })
})

describe('applySessionControl（会话状态转移）', () => {
  it('pause / resume（继续后当前日重新计时）', () => {
    const running = session()
    expect(applySessionControl(running, { action: 'pause' }, 999)).toMatchObject({ status: 'paused' })
    expect(applySessionControl(session({ status: 'paused' }), { action: 'resume' }, 999)).toMatchObject({
      status: 'running',
      lastTickAt: 999
    })
    // 无会话 no-op
    expect(applySessionControl(null, { action: 'pause' }, 0)).toBeNull()
  })

  it('speed 热切换：running 按进度比例折算计时锚点，paused 仅换值，ended 原样', () => {
    // 已结算到 now 的 running 会话（当前日进度 50%）：10s -> 2s 后锚点 = now - 1s
    const settled = session({ lastTickAt: 1_000_000 })
    const now = 1_000_000 + 5_000
    const switched = applySessionControl(settled, { action: 'speed', speedMs: 2_000 }, now)
    expect(switched).toMatchObject({ speedMs: 2_000, lastTickAt: now - 1_000 })
    expect(applySessionControl(session({ status: 'paused' }), { action: 'speed', speedMs: 5_000 }, 9)).toMatchObject({
      status: 'paused',
      speedMs: 5_000
    })
    const ended = session({ status: 'ended', dayIndex: 5 })
    expect(applySessionControl(ended, { action: 'speed', speedMs: 5_000 }, 9)).toBe(ended)
    // 无会话 no-op
    expect(applySessionControl(null, { action: 'speed', speedMs: 5_000 }, 0)).toBeNull()
  })
})

describe('SimTradingError', () => {
  it('携带领域错误码', () => {
    const error = new SimTradingError('insufficient_cash', '可用资金不足|Insufficient cash')
    expect(error).toBeInstanceOf(Error)
    expect(error.simCode).toBe('insufficient_cash')
    expect(error.message).toContain('|')
  })
})
