import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getEnv } from '../../env'

// ==================== SQLite 连接（进程级单例） ====================
// node:sqlite（Node >= 24 stable）；WAL 提升读写并发；globalThis 缓存防 dev 热重载句柄泄漏。
// 测试不经过本模块：直接 new DatabaseSync(':memory:') 注入 repository。

const globalForDb = globalThis as unknown as { __simTradingDb?: DatabaseSync }

export const getSimDb = (): DatabaseSync => {
  if (globalForDb.__simTradingDb != null) {
    return globalForDb.__simTradingDb
  }
  const path = resolve(process.cwd(), getEnv().SIM_TRADING_DB_PATH)
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  globalForDb.__simTradingDb = db
  return db
}
