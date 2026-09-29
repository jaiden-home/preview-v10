import type { DatabaseSync } from 'node:sqlite'

// ==================== 表结构（按账户 sid 隔离；关系型可 SQL 直查） ====================
// 领域模型 TradingAccount 仍是内存整对象（纯函数口径），表行仅为持久化拆分：
// sim_account 标量 + sim_position 持仓 + sim_trade 成交流水 + sim_session 回放会话。

export const initSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sim_account (
      sid               TEXT PRIMARY KEY,
      cash              REAL    NOT NULL,
      initial_capital   REAL    NOT NULL,
      day_key           TEXT    NOT NULL,
      day_start_equity  REAL    NOT NULL,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sim_position (
      sid           TEXT    NOT NULL,
      code          TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      qty           INTEGER NOT NULL,
      available_qty INTEGER NOT NULL,
      frozen_qty    INTEGER NOT NULL,
      frozen_date   TEXT    NOT NULL,
      cost_price    REAL    NOT NULL,
      PRIMARY KEY (sid, code)
    );

    CREATE TABLE IF NOT EXISTS sim_trade (
      id           TEXT PRIMARY KEY,
      sid          TEXT    NOT NULL,
      ts           INTEGER NOT NULL,
      code         TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      side         TEXT    NOT NULL,
      price        REAL    NOT NULL,
      qty          INTEGER NOT NULL,
      amount       REAL    NOT NULL,
      fee          REAL    NOT NULL,
      realized_pnl REAL,
      rowid_seq    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sim_trade_sid ON sim_trade (sid, rowid_seq);

    CREATE TABLE IF NOT EXISTS sim_session (
      sid          TEXT    NOT NULL PRIMARY KEY,
      status       TEXT    NOT NULL,
      speed_ms     INTEGER NOT NULL,
      anchor_code  TEXT    NOT NULL,
      start_date   TEXT    NOT NULL,
      day_count    INTEGER NOT NULL,
      day_index    INTEGER NOT NULL,
      last_tick_at INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
  `)
}
