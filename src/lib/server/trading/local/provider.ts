import type { DatabaseSync } from 'node:sqlite'
import { createInitialAccount, type TradingAccount } from '@/lib/trading/account'
import type { SimOrderInput, SimOrderResult, SimSessionAction, SimState } from '@/lib/trading/protocol'
import { SimTradingError, type SimTradingProvider } from '../contract'
import {
  applySessionControl,
  createMarketSource,
  placeOrderEngine,
  replayViewOf,
  settleSim,
  startSessionEngine,
  type MarketSource
} from '../engine'
import { getSimDb } from './db'
import { SimRepository } from './repository'

// ==================== 本地撮合实现（SQLite 持久化 + 纯函数账务） ====================
// 日后接真实交易接口：新增 remote/ 平级实现并在 registry 登记，本目录整体退役。

export interface LocalTradingDeps {
  /** 测试注入内存库；缺省用 getSimDb() 文件库 */
  db?: DatabaseSync
  /** 测试注入确定性行情源；缺省用 BFF 既有行情服务 */
  source?: MarketSource
  /** 测试注入假时钟；缺省 Date.now */
  now?: () => number
}

export const createLocalTradingProvider = (deps: LocalTradingDeps = {}): SimTradingProvider => {
  const repo = new SimRepository(deps.db ?? getSimDb())
  const source = deps.source ?? createMarketSource()
  const now = deps.now ?? Date.now

  // 同一 sid 的请求串行化（进程内）：防并发读改写交错
  const locks = new Map<string, Promise<unknown>>()
  const serialized = async <T>(sid: string, task: () => Promise<T>): Promise<T> => {
    const prev = locks.get(sid) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(task)
    locks.set(sid, next)
    try {
      return await next
    } finally {
      if (locks.get(sid) === next) {
        locks.delete(sid)
      }
    }
  }

  /** 读取（未开户自动建立初始账户），并按服务端时钟结算后持久化；有会话附带回放视图（锚定标的） */
  const loadSettled = async (sid: string): Promise<SimState> => {
    const existing = repo.loadAccount(sid)
    const account: TradingAccount = existing ?? createInitialAccount(now())
    const session = repo.loadSession(sid)
    const settled = await settleSim(account, session, now(), source)
    if (existing == null || settled.changed) {
      repo.saveAccount(sid, settled.account, now())
      if (settled.session != null) {
        repo.saveSession(sid, settled.session, now())
      }
    }
    return {
      account: settled.account,
      session: settled.session,
      serverNow: now(),
      replay:
        settled.session != null ? await replayViewOf(settled.session.anchorCode, settled.session, source) : undefined
    }
  }

  return {
    id: 'local',
    capabilities: { replaySession: true },

    getState: (sid) => serialized(sid, () => loadSettled(sid)),

    placeOrder: (sid, order: SimOrderInput) =>
      serialized(sid, async (): Promise<SimOrderResult> => {
        try {
          const base = await loadSettled(sid)
          const execution = await placeOrderEngine(base.account, base.session, order, now(), source)
          repo.saveAccount(sid, execution.account, now())
          if (execution.session != null && execution.sessionChanged) {
            repo.saveSession(sid, execution.session, now())
          }
          return { ok: true, state: { account: execution.account, session: execution.session, serverNow: now() } }
        } catch (error) {
          if (error instanceof SimTradingError) {
            return { ok: false, code: error.simCode, message: error.message }
          }
          throw error
        }
      }),

    controlSession: (sid, action: SimSessionAction) =>
      serialized(sid, async () => {
        if (action.action === 'restart') {
          const fresh = createInitialAccount(now())
          repo.deleteSession(sid)
          repo.saveAccount(sid, fresh, now())
          return { account: fresh, session: null, serverNow: now() }
        }
        if (action.action === 'start') {
          const base = await loadSettled(sid)
          const started = await startSessionEngine(base.account, action, now(), source)
          repo.saveAccount(sid, started.account, now())
          repo.saveSession(sid, started.session, now())
          return {
            account: started.account,
            session: started.session,
            serverNow: now(),
            replay: await replayViewOf(started.session.anchorCode, started.session, source)
          }
        }
        const base = await loadSettled(sid)
        const next = applySessionControl(base.session, action, now())
        if (next !== base.session && next != null) {
          repo.saveSession(sid, next, now())
        }
        return { account: base.account, session: next, serverNow: now() }
      })
  }
}
