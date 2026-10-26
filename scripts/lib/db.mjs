// 脚本侧数据库连接：与应用侧 src/lib/server/market-db/db.ts 指向同一个库文件（默认 dbdata/market.db）。
// 分工：应用侧只读（readOnly + query_only），数据写入只发生在脚本侧（本目录任务），口径参照 market 项目。
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 库文件路径：MARKET_DB_PATH 环境变量（默认 ./dbdata/market.db，与应用侧 env.ts 同口径）。 */
export const DB_PATH = path.resolve(ROOT, process.env.MARKET_DB_PATH || './dbdata/market.db')

/** 打开数据库连接（不建目录不建表——五表随 market.db 快照而来，本项目不自建表），WAL + 外键 + 写锁等待。 */
export function openDb() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`库文件不存在：${DB_PATH}（market.db 未就位，请先自 market 项目复制）`)
    process.exit(1)
  }
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 30000;') // 与 dev 服务只读连接并发时最多等 30s 再报错
  return db
}

/** 本地时间文本 YYYY-MM-DD HH:MM:SS（项目通用约定）。 */
export function nowStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// ── 任务状态文件（taskId → { last_run_at, last_status, final_through, phase, ... }） ──
const STATE_PATH = path.join(ROOT, 'dbdata', 'task_runs.json')

/** 读取任务状态（不存在或损坏 → 空对象，视为首次）。 */
export function loadTaskState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

/** 写入任务状态（原子替换整份 JSON，逐任务落定即写盘）。 */
export function saveTaskState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n')
}
