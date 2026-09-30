import { describe, expect, it } from 'vitest'
import { REPLAY_SPEED_MS } from '@/lib/trading/replay'
import type { SimErrorCode, SimOrderInput, SimOrderResult, SimSessionAction, SimState } from '@/lib/trading/protocol'

// ==================== 模拟交易服务契约（BFF 路由唯一依赖） ====================
// 切换真实交易接口 = 新增平级实现目录（如 remote/）+ registry 登记 + SIM_TRADING_PROVIDER 指向它，
// 路由与前端零改动；新实现上线门槛 = 实现 SimTradingProvider + 通过本契约测试套件。

/** 会话控制等编排失败的领域错误（route 层捕获转 4xx JSON） */
export class SimTradingError extends Error {
  constructor(
    readonly simCode: SimErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SimTradingError'
  }
}

export interface SimTradingProvider {
  /** 实现标识（registry 登记的 id） */
  id: string
  capabilities: {
    /** 是否支持历史回放会话（真实交易接口无虚拟时钟，simtrade 回放模式据此降级） */
    replaySession: boolean
  }
  /** 账户 + 会话快照（内部先按服务端时钟结算再返回） */
  getState(sid: string): Promise<SimState>
  /** 下单（服务端权威校验与成交；虚拟成交时间由服务端会话推导） */
  placeOrder(sid: string, order: SimOrderInput): Promise<SimOrderResult>
  /** 会话控制（start/pause/resume/restart） */
  controlSession(sid: string, action: SimSessionAction): Promise<SimState>
}

/**
 * Provider 契约测试套件：对任意实现跑同一套状态机断言，保证可替换性。
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

    it('getState 未开户自动建立初始账户', async () => {
      const state = await makeProvider().getState(sid())
      expect(state.account.cash).toBeGreaterThan(0)
      expect(state.account.positions).toEqual([])
      expect(state.account.trades).toEqual([])
      expect(state.session).toBeNull()
      expect(state.serverNow).toBe(clock.now())
    })

    it('start 建立回放会话：第 1 个交易日立即完成且 running', async () => {
      const provider = makeProvider()
      const state = await startSession(provider, sid())
      expect(state.session).not.toBeNull()
      expect(state.session!.status).toBe('running')
      expect(state.session!.dayIndex).toBe(1)
      expect(state.session!.anchorCode).toBe('sh600519')
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
