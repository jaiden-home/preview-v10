import { describe, expect, it } from 'vitest'
import { REPLAY_SPEED_MS } from '@/lib/trading/replay'
import type { SimOrderInput, SimOrderResult } from '@/lib/trading/protocol'
import type { SimTradingProvider } from './contract'

// ==================== Provider 契约测试套件（仅测试模块图，生产代码见 contract.ts） ====================

/**
 * 对任意实现跑同一套状态机断言，保证可替换性。
 * makeProvider 需注入确定性行情源与时钟（上游 stub 由具体实现的测试文件装配）。
 */
export const runSimTradingContractTests = (
  makeProvider: () => SimTradingProvider,
  clock: { now: () => number; advance: (ms: number) => void }
): void => {
  const sid = () => `test-sid-${Math.random().toString(36).slice(2)}`

  const startSession = async (provider: SimTradingProvider, id: string) =>
    provider.controlSession(id, { action: 'start', anchorCode: 'sh600519', startDate: '2024-06-03' })

  describe('sim trading provider contract', () => {
    it('暴露合法 id 与能力声明', () => {
      const provider = makeProvider()
      expect(provider.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(typeof provider.capabilities.replaySession).toBe('boolean')
    })

    it('getState 未开户自动建立初始账户（无会话无回放视图）', async () => {
      const state = await makeProvider().getState(sid())
      expect(state.account.cash).toBeGreaterThan(0)
      expect(state.account.positions).toEqual([])
      expect(state.account.trades).toEqual([])
      expect(state.session).toBeNull()
      expect(state.replay).toBeUndefined()
      expect(state.serverNow).toBe(clock.now())
    })

    it('start 建立回放会话：第 1 个交易日立即完成且 running，并附带回放视图', async () => {
      const provider = makeProvider()
      const id = sid()
      const state = await startSession(provider, id)
      expect(state.session).not.toBeNull()
      expect(state.session!.status).toBe('running')
      expect(state.session!.dayIndex).toBe(1)
      expect(state.session!.anchorCode).toBe('sh600519')
      // 视图 = 起始日前历史 + 全部模拟日（含未完成，前端按 dayIndex 揭示）+ 标的名称
      expect(state.replay).toMatchObject({ code: 'sh600519', history: [], name: '贵州茅台' })
      expect(state.replay!.simDays).toHaveLength(5)
      // getState 同样带回视图（恢复路径）
      expect((await provider.getState(id)).replay).toMatchObject({ code: 'sh600519' })
    })

    it('start(paused) 开局即暂停：第 1 天停住，继续后起走', async () => {
      const provider = makeProvider()
      const id = sid()
      const pausedStart = await provider.controlSession(id, {
        action: 'start',
        anchorCode: 'sh600519',
        startDate: '2024-06-03',
        paused: true
      })
      expect(pausedStart.session).toMatchObject({ status: 'paused', dayIndex: 1 })
      // 暂停期间时间流逝不推进
      clock.advance(60_000)
      expect((await provider.getState(id)).session!.dayIndex).toBe(1)
      // 继续后起走（当前日重新计时）
      await provider.controlSession(id, { action: 'resume' })
      clock.advance(REPLAY_SPEED_MS)
      expect((await provider.getState(id)).session!.dayIndex).toBe(2)
    })

    it('start(speedMs) 开局带倍速；speed 热切换保留当前日进度', async () => {
      const provider = makeProvider()
      const id = sid()
      const fast = await provider.controlSession(id, {
        action: 'start',
        anchorCode: 'sh600519',
        startDate: '2024-06-03',
        speedMs: 2_000
      })
      expect(fast.session!.speedMs).toBe(2_000)

      // 走 1s（2x 的一个交易日）后热切回 1x：进度 0 重算，不跳日
      clock.advance(2_000)
      let state = await provider.getState(id)
      expect(state.session!.dayIndex).toBe(2)
      const switched = await provider.controlSession(id, { action: 'speed', speedMs: REPLAY_SPEED_MS })
      expect(switched.session!.speedMs).toBe(REPLAY_SPEED_MS)
      // 热切换不结转跨日账务外的状态：仍 running 且 dayIndex 不变
      state = await provider.getState(id)
      expect(state.session).toMatchObject({ status: 'running', dayIndex: 2 })

      // 无会话 speed no-op
      const noSession = await provider.controlSession(sid(), { action: 'speed', speedMs: 5_000 })
      expect(noSession.session).toBeNull()
    })

    it('live 下单成交：成交价/数量入库，虚拟日冻结 T+1', async () => {
      const provider = makeProvider()
      const id = sid()
      await startSession(provider, id)
      const order: SimOrderInput = { side: 'buy', code: 'sh600519', name: '贵州茅台', price: 100, qty: 100 }
      const result: SimOrderResult = await provider.placeOrder(id, order)
      expect(result.ok).toBe(true)
      if (!result.ok) {
        return
      }
      expect(result.state.account.positions).toHaveLength(1)
      expect(result.state.account.positions[0]).toMatchObject({ code: 'sh600519', qty: 100, availableQty: 0 })
      expect(result.state.account.trades).toHaveLength(1)
    })

    it('无会话（自动开局在途）下单拒绝 no_active_session', async () => {
      const provider = makeProvider()
      const rejected = await provider.placeOrder(sid(), {
        side: 'buy',
        code: 'sh600519',
        price: 100,
        qty: 100
      })
      expect(rejected.ok).toBe(false)
      if (rejected.ok) {
        return
      }
      expect(rejected.code).toBe('no_active_session')
    })

    it('暂停后拒单（session_not_running），继续后恢复可交易', async () => {
      const provider = makeProvider()
      const id = sid()
      await startSession(provider, id)
      await provider.controlSession(id, { action: 'pause' })
      const rejected = await provider.placeOrder(id, { side: 'buy', code: 'sh600519', price: 100, qty: 100 })
      expect(rejected.ok).toBe(false)
      if (rejected.ok) {
        return
      }
      expect(rejected.code).toBe('session_not_running')

      await provider.controlSession(id, { action: 'resume' })
      const resumed = await provider.placeOrder(id, { side: 'buy', code: 'sh600519', price: 100, qty: 100 })
      expect(resumed.ok).toBe(true)
    })

    it('服务端时钟推进跨日（T+1 解冻）并到 dayCount 封顶 ended', async () => {
      const provider = makeProvider()
      const id = sid()
      await startSession(provider, id)
      await provider.placeOrder(id, { side: 'buy', code: 'sh600519', price: 100, qty: 100 })

      // 推进 1 个虚拟日：当日买入解冻为可卖
      clock.advance(REPLAY_SPEED_MS)
      let state = await provider.getState(id)
      expect(state.session!.dayIndex).toBe(2)
      expect(state.account.positions[0]!.availableQty).toBe(100)

      // 推到走满：ended 封顶，dayIndex 不再超过 dayCount
      clock.advance(REPLAY_SPEED_MS * 10)
      state = await provider.getState(id)
      expect(state.session!.status).toBe('ended')
      expect(state.session!.dayIndex).toBe(state.session!.dayCount)
    })

    it('restart 清会话并重置账户', async () => {
      const provider = makeProvider()
      const id = sid()
      await startSession(provider, id)
      await provider.placeOrder(id, { side: 'buy', code: 'sh600519', price: 100, qty: 100 })
      const state = await provider.controlSession(id, { action: 'restart' })
      expect(state.session).toBeNull()
      expect(state.account.positions).toEqual([])
      expect(state.account.trades).toEqual([])
    })
  })
}
