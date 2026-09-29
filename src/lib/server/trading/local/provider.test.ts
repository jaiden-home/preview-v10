import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { INITIAL_CASH } from '@/lib/trading/account'
import { runSimTradingContractTests } from '../contract'
import type { MarketSource } from '../engine'
import { createLocalTradingProvider } from './provider'

// ==================== local provider 测试：注入确定性行情源 + 假时钟 + 内存库 ====================
// 契约套件保证可替换性（真实接口实现上线时跑同一套断言）；
// 附加用例覆盖 SQLite 持久化与 sid 隔离等实现细节。

/** 固定行情：2024-06-03（周一）起 5 个交易日，收盘 100/110/120/130/140 */
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

const source: MarketSource = {
  replayBars: async (code) => (code === 'sh600519' ? BARS : []),
  liveQuote: async (code) => (code === 'sh600519' ? { name: '贵州茅台', price: 100, prevClose: 99 } : null)
}

const clock = (() => {
  let t = new Date(2026, 0, 15, 9, 30).getTime()
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    }
  }
})()

const makeProvider = () =>
  createLocalTradingProvider({
    db: new DatabaseSync(':memory:'),
    source,
    now: clock.now
  })

runSimTradingContractTests(makeProvider, clock)

describe('local provider（SQLite 持久化与隔离）', () => {
  it('状态跨实例持久化（同库文件语义：新 provider 读同一内存库）', async () => {
    const db = new DatabaseSync(':memory:')
    const writer = createLocalTradingProvider({ db, source, now: clock.now })
    const sid = 'persist-sid'
    await writer.controlSession(sid, {
      action: 'start',
      anchorCode: 'sh600519',
      startDate: '2024-06-03',
      speedMs: 30_000
    })
    await writer.placeOrder(sid, { side: 'buy', code: 'sh600519', name: '贵州茅台', price: 100, qty: 100 })

    // 新实例（模拟进程重启）：从库恢复会话与账户
    const reader = createLocalTradingProvider({ db, source, now: clock.now })
    const state = await reader.getState(sid)
    expect(state.session).not.toBeNull()
    expect(state.session!.dayIndex).toBe(1)
    expect(state.account.positions).toHaveLength(1)
    expect(state.account.trades).toHaveLength(1)
  })

  it('不同 sid 账户与会话互不干扰', async () => {
    const provider = makeProvider()
    await provider.controlSession('sid-a', {
      action: 'start',
      anchorCode: 'sh600519',
      startDate: '2024-06-03',
      speedMs: 30_000
    })
    const b = await provider.getState('sid-b')
    expect(b.session).toBeNull()
    expect(b.account.cash).toBe(INITIAL_CASH)
    expect(b.account.positions).toEqual([])
  })

  it('暂停期间时间流逝不推进（lastTickAt 冻结语义）', async () => {
    const provider = makeProvider()
    const sid = 'pause-sid'
    await provider.controlSession(sid, {
      action: 'start',
      anchorCode: 'sh600519',
      startDate: '2024-06-03',
      speedMs: 30_000
    })
    await provider.controlSession(sid, { action: 'pause' })
    clock.advance(30_000 * 5)
    const state = await provider.getState(sid)
    expect(state.session!.status).toBe('paused')
    expect(state.session!.dayIndex).toBe(1)
    // 继续后当前日重新计时
    await provider.controlSession(sid, { action: 'resume' })
    clock.advance(29_999)
    expect((await provider.getState(sid)).session!.dayIndex).toBe(1)
  })
})
