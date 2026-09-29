import type { DatabaseSync } from 'node:sqlite'
import { MAX_TRADE_RECORDS, type Position, type TradeRecord, type TradingAccount } from '@/lib/trading/account'
import type { SimSession } from '@/lib/trading/protocol'
import { initSchema } from './schema'

// ==================== 持久化仓库（纯 SQL 读写，sid 维度隔离） ====================
// 读：三表重组为内存领域模型 TradingAccount（纯函数口径）；
// 写：整账户覆盖式（模拟盘单账户低频写，简单压倒增量），事务保证原子。

interface AccountRow {
  sid: string
  cash: number
  initial_capital: number
  day_key: string
  day_start_equity: number
}

interface PositionRow {
  code: string
  name: string
  qty: number
  available_qty: number
  frozen_qty: number
  frozen_date: string
  cost_price: number
}

interface TradeRow {
  id: string
  ts: number
  code: string
  name: string
  side: string
  price: number
  qty: number
  amount: number
  fee: number
  realized_pnl: number | null
  rowid_seq: number
}

interface SessionRow {
  status: string
  speed_ms: number
  anchor_code: string
  start_date: string
  day_count: number
  day_index: number
  last_tick_at: number
}

export class SimRepository {
  constructor(private readonly db: DatabaseSync) {
    initSchema(db)
  }

  loadAccount(sid: string): TradingAccount | null {
    const account = this.db
      .prepare('SELECT cash, initial_capital, day_key, day_start_equity FROM sim_account WHERE sid = ?')
      .get(sid) as AccountRow | undefined
    if (account == null) {
      return null
    }
    const positions = (
      this.db
        .prepare(
          'SELECT code, name, qty, available_qty, frozen_qty, frozen_date, cost_price FROM sim_position WHERE sid = ? ORDER BY code'
        )
        .all(sid) as unknown as PositionRow[]
    ).map(toPosition)
    const trades = (
      this.db
        .prepare(
          'SELECT id, ts, code, name, side, price, qty, amount, fee, realized_pnl, rowid_seq FROM sim_trade WHERE sid = ? ORDER BY rowid_seq DESC LIMIT ?'
        )
        .all(sid, MAX_TRADE_RECORDS) as unknown as TradeRow[]
    ).map(toTrade)
    return {
      cash: account.cash,
      initialCapital: account.initial_capital,
      dayKey: account.day_key,
      dayStartEquity: account.day_start_equity,
      positions,
      trades
    }
  }

  /** 整账户覆盖写（事务）：账户标量 upsert + 持仓/成交全量重写 */
  saveAccount(sid: string, account: TradingAccount, now: number = Date.now()): void {
    const withTx = <T>(fn: () => T): T => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn()
        this.db.exec('COMMIT')
        return result
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
    withTx(() => {
      this.db
        .prepare(
          `INSERT INTO sim_account (sid, cash, initial_capital, day_key, day_start_equity, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET
             cash = excluded.cash,
             initial_capital = excluded.initial_capital,
             day_key = excluded.day_key,
             day_start_equity = excluded.day_start_equity,
             updated_at = excluded.updated_at`
        )
        .run(sid, account.cash, account.initialCapital, account.dayKey, account.dayStartEquity, now, now)

      this.db.prepare('DELETE FROM sim_position WHERE sid = ?').run(sid)
      const insertPosition = this.db.prepare(
        'INSERT INTO sim_position (sid, code, name, qty, available_qty, frozen_qty, frozen_date, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      for (const p of account.positions) {
        insertPosition.run(sid, p.code, p.name, p.qty, p.availableQty, p.frozenQty, p.frozenDate, p.costPrice)
      }

      this.db.prepare('DELETE FROM sim_trade WHERE sid = ?').run(sid)
      const insertTrade = this.db.prepare(
        'INSERT INTO sim_trade (id, sid, ts, code, name, side, price, qty, amount, fee, realized_pnl, rowid_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      // trades 新在前：写入序号取反，读回 ORDER BY rowid_seq DESC 还原
      const total = account.trades.length
      account.trades.forEach((t, i) => {
        insertTrade.run(
          t.id,
          sid,
          t.ts,
          t.code,
          t.name,
          t.side,
          t.price,
          t.qty,
          t.amount,
          t.fee,
          t.realizedPnl,
          total - i
        )
      })
    })
  }

  loadSession(sid: string): SimSession | null {
    const row = this.db
      .prepare(
        'SELECT status, speed_ms, anchor_code, start_date, day_count, day_index, last_tick_at FROM sim_session WHERE sid = ?'
      )
      .get(sid) as SessionRow | undefined
    if (row == null) {
      return null
    }
    return {
      status: row.status as SimSession['status'],
      speedMs: row.speed_ms as SimSession['speedMs'],
      anchorCode: row.anchor_code,
      startDate: row.start_date,
      dayCount: row.day_count,
      dayIndex: row.day_index,
      lastTickAt: row.last_tick_at
    }
  }

  saveSession(sid: string, session: SimSession, now: number = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO sim_session (sid, status, speed_ms, anchor_code, start_date, day_count, day_index, last_tick_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET
           status = excluded.status,
           speed_ms = excluded.speed_ms,
           anchor_code = excluded.anchor_code,
           start_date = excluded.start_date,
           day_count = excluded.day_count,
           day_index = excluded.day_index,
           last_tick_at = excluded.last_tick_at,
           updated_at = excluded.updated_at`
      )
      .run(
        sid,
        session.status,
        session.speedMs,
        session.anchorCode,
        session.startDate,
        session.dayCount,
        session.dayIndex,
        session.lastTickAt,
        now
      )
  }

  deleteSession(sid: string): void {
    this.db.prepare('DELETE FROM sim_session WHERE sid = ?').run(sid)
  }
}

const toPosition = (row: PositionRow): Position => ({
  code: row.code,
  name: row.name,
  qty: row.qty,
  availableQty: row.available_qty,
  frozenQty: row.frozen_qty,
  frozenDate: row.frozen_date,
  costPrice: row.cost_price
})

const toTrade = (row: TradeRow): TradeRecord => ({
  id: row.id,
  ts: row.ts,
  code: row.code,
  name: row.name,
  side: row.side as TradeRecord['side'],
  price: row.price,
  qty: row.qty,
  amount: row.amount,
  fee: row.fee,
  realizedPnl: row.realized_pnl
})
