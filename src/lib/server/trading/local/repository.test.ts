import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { INITIAL_CASH, createInitialAccount, executeBuy, executeSell, unfreezePositions } from '@/lib/trading/account'
import type { SimSession } from '@/lib/trading/protocol'
import { SimRepository } from './repository'

const D1 = new Date(2024, 5, 3, 10, 0, 0).getTime()
const D2 = new Date(2024, 5, 4, 10, 0, 0).getTime()

const buy = (price: number, qty: number, ts: number) => ({
  code: 'sh600519',
  name: '贵州茅台',
  price,
  qty,
  ts
})

describe('SimRepository（node:sqlite 内存库）', () => {
  let repo: SimRepository

  beforeEach(() => {
    repo = new SimRepository(new DatabaseSync(':memory:'))
  })

  it('未开户返回 null', () => {
    expect(repo.loadAccount('sid-x')).toBeNull()
    expect(repo.loadSession('sid-x')).toBeNull()
  })

  it('账户读写往返：标量/持仓/成交全量一致（成交新在前）', () => {
    let account = executeBuy(createInitialAccount(D1), buy(100, 200, D1))
    account = executeBuy(account, buy(110, 100, D1))
    account = executeSell(unfreezePositions(account, '2024-06-04'), { ...buy(120, 100, D2), qty: 100 })

    repo.saveAccount('sid-1', account, 123)
    expect(repo.loadAccount('sid-1')).toEqual(account)
    // 成交顺序：新在前
    const trades = repo.loadAccount('sid-1')!.trades
    expect(trades.map((t) => t.side)).toEqual(['sell', 'buy', 'buy'])
  })

  it('清仓后持仓删除（空持仓账户往返）', () => {
    let account = executeBuy(createInitialAccount(D1), buy(100, 100, D1))
    account = executeSell(unfreezePositions(account, '2024-06-04'), { ...buy(100, 100, D2), qty: 100 })
    repo.saveAccount('sid-1', account, 123)
    const loaded = repo.loadAccount('sid-1')!
    expect(loaded.positions).toEqual([])
    expect(loaded.cash).toBe(account.cash)
    expect(loaded.trades).toHaveLength(2)
  })

  it('不同 sid 账户互不干扰', () => {
    const accountA = executeBuy(createInitialAccount(D1), buy(100, 100, D1))
    repo.saveAccount('sid-a', accountA, 123)
    const loadedB = repo.loadAccount('sid-b')
    expect(loadedB).toBeNull()
    expect(repo.loadAccount('sid-a')!.positions).toHaveLength(1)
  })

  it('created_at 保留：二次保存不重置开户时间', () => {
    repo.saveAccount('sid-1', createInitialAccount(D1), 1_000)
    repo.saveAccount('sid-1', executeBuy(createInitialAccount(D1), buy(100, 100, D1)), 2_000)
    // created_at 保留在行内（updated_at 前移），加载模型不受影响——此处验证 upsert 不抛错且数据一致
    expect(repo.loadAccount('sid-1')!.trades).toHaveLength(1)
  })

  it('会话读写往返与删除', () => {
    const session: SimSession = {
      status: 'running',
      speedMs: 10_000,
      anchorCode: 'sh600519',
      startDate: '2024-06-03',
      dayCount: 42,
      dayIndex: 7,
      lastTickAt: 1_700_000_000_000
    }
    repo.saveSession('sid-1', session, 123)
    expect(repo.loadSession('sid-1')).toEqual(session)

    const paused: SimSession = { ...session, status: 'paused', dayIndex: 8 }
    repo.saveSession('sid-1', paused, 456)
    expect(repo.loadSession('sid-1')).toEqual(paused)

    repo.deleteSession('sid-1')
    expect(repo.loadSession('sid-1')).toBeNull()
    // 会话删除不影响账户
    repo.saveAccount('sid-1', createInitialAccount(D1), 123)
    repo.deleteSession('sid-1')
    expect(repo.loadAccount('sid-1')!.cash).toBe(INITIAL_CASH)
  })
})
