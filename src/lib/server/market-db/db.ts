import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getEnv } from '../env'

// ==================== 行情快照库连接（进程级单例，只读） ====================
// market.db 自 market 项目复制（含 stocks / concepts / stock_concepts / kline_daily /
// leader_events 五表）；本模块只读查询，写入与建表一律在 market 项目完成。
// globalThis 缓存防 dev 热重载句柄泄漏；库文件缺失时不创建（复制后可用）。

const globalForDb = globalThis as unknown as { __marketDb?: DatabaseSync }

export const marketDbPath = (): string => resolve(process.cwd(), getEnv().MARKET_DB_PATH)

/** 库文件是否就位（未复制时页面走引导空态，不抛错） */
export const marketDbExists = (): boolean => existsSync(marketDbPath())

/** 获取只读连接单例（文件缺失时抛错，调用方先以 marketDbExists() 判定） */
export const getMarketDb = (): DatabaseSync => {
  if (globalForDb.__marketDb != null) {
    return globalForDb.__marketDb
  }
  const db = new DatabaseSync(marketDbPath(), { readOnly: true })
  db.exec('PRAGMA query_only = ON')
  globalForDb.__marketDb = db
  return db
}
