import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadBoard } from './board'

// ==================== 领涨看板数据服务测试（:memory: 夹具） ====================
// 口径锁定：热力四周期聚合 / 趋势过滤（周链+均线+上市满一年）/ B 点 /
// 本月进入标记 / 停用股剔除。夹具用连续自然日模拟交易日（weekKeyOf 按自然周分组，算法无碍）。

const LAST_DATE = '2026-06-15'

/** 生成 [start, end] 的连续自然日（YYYY-MM-DD） */
const dayRange = (start: string, end: string): string[] => {
  const days: string[] = []
  const cur = new Date(`${start}T00:00:00`)
  const stop = new Date(`${end}T00:00:00`)
  while (cur <= stop) {
    const p = (x: number): string => `${x}`.padStart(2, '0')
    days.push(`${cur.getFullYear()}-${p(cur.getMonth() + 1)}-${p(cur.getDate())}`)
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

const DAYS = dayRange('2024-12-01', LAST_DATE) // ~562 自然日 > 365 + 60 预热

interface FixtureStock {
  code: string
  name: string
  exchange: 'SH' | 'SZ'
  board: 'main' | 'gem'
  enabled: number
  concept: string
  /** 每日收盘生成器（索引 → 收盘价）；返回 null = 当日无 K 线（退市/停牌模拟） */
  close: (index: number) => number
  /** 领涨事件日（DAYS 内日期） */
  leaderDays: string[]
}

const FIXTURES: FixtureStock[] = [
  {
    // 甲：先横盘 200 日（run 恒 0），此后每日 +1% → 第 203 日 run=3 触发 B（MA30 已可算），
    // 此后连涨链不断不再等于 3 → lastBuy 恒为首个 B；尾段趋势达标
    code: '000001',
    name: '平安银行',
    exchange: 'SZ',
    board: 'main',
    enabled: 1,
    concept: '银行',
    close: (i) => (i < 200 ? 10 : 10 * 1.01 ** (i - 200)),
    leaderDays: [DAYS[100]!, DAYS[200]!]
  },
  {
    // 乙：全程横盘 → 周线强涨链断裂，趋势过滤剔除（仍在候选池，验证过滤生效）
    code: '000002',
    name: '万科A',
    exchange: 'SZ',
    board: 'main',
    enabled: 1,
    concept: '地产',
    close: () => 20,
    leaderDays: [DAYS[150]!]
  },
  {
    // 丙：停用股（enabled=0）→ 领涨聚合直接剔除
    code: '600000',
    name: '浦发银行',
    exchange: 'SH',
    board: 'main',
    enabled: 0,
    concept: '银行',
    close: (i) => 8 * 1.005 ** i,
    leaderDays: [DAYS[120]!]
  }
]

const buildDb = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`CREATE TABLE stocks (
    code TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL, board TEXT NOT NULL,
    industry TEXT, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)`)
  db.exec(`CREATE TABLE concepts (
    name TEXT PRIMARY KEY, category TEXT NOT NULL, sort INTEGER NOT NULL, updated_at TEXT NOT NULL)`)
  db.exec(`CREATE TABLE stock_concepts (
    code TEXT PRIMARY KEY REFERENCES stocks(code) ON DELETE CASCADE,
    concept_name TEXT NOT NULL REFERENCES concepts(name) ON DELETE CASCADE, updated_at TEXT NOT NULL)`)
  db.exec(`CREATE TABLE kline_daily (
    code TEXT NOT NULL REFERENCES stocks(code) ON DELETE CASCADE, trade_date TEXT NOT NULL,
    open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
    volume REAL NOT NULL, amount REAL NOT NULL, PRIMARY KEY (code, trade_date))`)
  db.exec(`CREATE TABLE leader_events (
    code TEXT NOT NULL REFERENCES stocks(code) ON DELETE CASCADE,
    concept_name TEXT NOT NULL REFERENCES concepts(name) ON DELETE CASCADE,
    exchange TEXT NOT NULL, trade_date TEXT NOT NULL, pct REAL NOT NULL, reason TEXT NOT NULL,
    concept_avg REAL NOT NULL, concept_up_ratio REAL NOT NULL, PRIMARY KEY (code, concept_name, trade_date))`)

  const insStock = db.prepare('INSERT INTO stocks VALUES (?, ?, ?, ?, NULL, ?, ?)')
  const insConcept = db.prepare('INSERT INTO concepts VALUES (?, ?, ?, ?)')
  const insMap = db.prepare('INSERT INTO stock_concepts VALUES (?, ?, ?)')
  const insBar = db.prepare('INSERT INTO kline_daily VALUES (?, ?, ?, ?, ?, ?, 1000, 10000)')
  const insEvent = db.prepare('INSERT INTO leader_events VALUES (?, ?, ?, ?, 10, ?, 5, 0.8)')

  insConcept.run('银行', '金融', 1000, '2026-01-01')
  insConcept.run('地产', '金融', 2000, '2026-01-01')

  for (const f of FIXTURES) {
    insStock.run(f.code, f.name, f.exchange, f.board, f.enabled, '2026-01-01')
    insMap.run(f.code, f.concept, '2026-01-01')
    DAYS.forEach((d, i) => {
      const close = f.close(i)
      insBar.run(f.code, d, close * 0.995, close * 1.01, close * 0.99, close)
    })
    for (const d of f.leaderDays) {
      insEvent.run(f.code, f.concept, f.exchange, d, 'top')
    }
  }
  return db
}

describe('loadBoard', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = buildDb()
  })

  afterEach(() => {
    db.close()
  })

  it('缺 kline_daily 表时返回 null（空态）', () => {
    const empty = new DatabaseSync(':memory:')
    empty.exec('CREATE TABLE stocks (code TEXT)')
    expect(loadBoard(empty)).toBeNull()
    empty.close()
  })

  it('meta：启用/停用/概念计数与领涨口径（停用股不入领涨池）', () => {
    const board = loadBoard(db)!
    expect(board).not.toBeNull()
    expect(board.meta.stocks).toBe(2) // 启用 2（甲乙），丙停用
    expect(board.meta.filtered).toBe(1)
    expect(board.meta.concepts).toBe(2)
    expect(board.meta.leaderStocks).toBe(3) // leader_events 全表口径（含停用丙；趋势过滤前候选池）
    expect(board.meta.leaderDays).toBe(4) // 甲 2 + 乙 1 + 丙 1（全表口径，日期互异）
    expect(board.meta.lastDate).toBe(LAST_DATE)
    expect(board.categories).toEqual(['金融'])
  })

  it('概念热力：日周期聚合等权均值/涨家数/领涨股', () => {
    const board = loadBoard(db)!
    const bank = board.periods.day.find((c) => c.name === '银行')!
    expect(bank).toBeDefined()
    expect(bank.category).toBe('金融')
    expect(bank.n).toBe(1) // 停用股不入概念映射（enabled JOIN）
    expect(bank.up).toBe(1)
    expect(bank.avgPct).toBeGreaterThan(0)
    expect(bank.avgPct).toBeCloseTo(1, 1) // 转涨后单日 +1%
    expect(bank.leader?.code).toBe('000001')
    const estate = board.periods.day.find((c) => c.name === '地产')!
    expect(estate.avgPct).toBe(0) // 横盘
    // 年周期基准早于起始日 → 无基准行，热力为空（夹具仅 562 天，年窗口基准缺失）
    // 周窗口（近 7 自然日）数据存在
    expect(board.periods.week.length).toBeGreaterThan(0)
  })

  it('领涨表：趋势过滤剔除横盘股，达标股指标齐备', () => {
    const board = loadBoard(db)!
    expect(board.leaders).toHaveLength(1)
    const row = board.leaders[0]!
    expect(row.code).toBe('000001')
    expect(row.name).toBe('平安银行')
    expect(row.exchange).toBe('SZ')
    expect(row.days).toBe(2)
    expect(row.days365).toBe(1) // 仅 DAYS[200]（≈2025-06-19）落在近 365 自然日内，DAYS[100] 超窗
    expect(row.events).toBe(2)
    expect(row.concepts).toEqual(['银行'])
    expect(row.category).toBe('金融')
    expect(row.pct).toBeGreaterThan(0.7) // 最新日 +0.8%
    expect(row.price).toBeGreaterThan(0)
    expect(row.streak).toBeGreaterThan(60) // 全程连涨
    expect(row.highStreak).toBeGreaterThan(60)
    expect(row.fastFlip).toBe(true) // 全程多头
    expect(row.maRatio).toBeGreaterThan(1)
    expect(row.trendDays).toBeGreaterThan(60)
    expect(row.lastBuy).not.toBeNull() // 第 3 个交易日触发 B（此后 run 持续 >3 不再复触发）
    expect(row.buyStreak).not.toBeNull()
    expect(row.limitUp365).toBe(0) // 日涨 0.8% 不触涨停
    expect(row.isNew).toBe(false) // 上月末已在名单
    expect(row.joinDate).toBeNull()
  })

  it('领涨概念按当前归属归组：划转后即时跟随（不读 leader_events 留档概念名）', () => {
    // leader_events 留档仍是「银行」；当前归属改到「地产」→ 领涨表概念/大类即时切换
    db.prepare("UPDATE stock_concepts SET concept_name = '地产' WHERE code = '000001'").run()
    const board = loadBoard(db)!
    const row = board.leaders.find((l) => l.code === '000001')!
    expect(row.concepts).toEqual(['地产'])
    expect(row.category).toBe('金融')
    // 移出到未归类 → concepts 为空、大类为 null（热力联动/搜索不再命中）
    db.prepare('DELETE FROM stock_concepts WHERE code = ?').run('000001')
    const board2 = loadBoard(db)!
    const row2 = board2.leaders.find((l) => l.code === '000001')!
    expect(row2.concepts).toEqual([])
    expect(row2.category).toBeNull()
  })

  it('B 点日期为横盘转涨后的首个三连涨链第 3 日（此后链不断不再等于 3）', () => {
    const board = loadBoard(db)!
    const row = board.leaders[0]!
    // 横盘段 run 恒 0；DAYS[200] 收盘与前收持平断链，DAYS[201] run=1、202 run=2、203 run=3 触发 B
    expect(row.lastBuy).toBe(DAYS[203]!)
  })

  it('本月进入标记：横盘掉出/回归场景（乙不达标不参与；甲全程在场）', () => {
    const board = loadBoard(db)!
    expect(board.leaders.every((l) => l.isNew === false)).toBe(true)
  })
})
