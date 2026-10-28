import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ConceptAdminError,
  createConcept,
  deleteConcept,
  loadConceptOverview,
  reorderConcept,
  renameCategory,
  searchStocks,
  setMember,
  updateConcept
} from './concepts'

// ==================== 概念管理域测试（:memory: 夹具） ====================
// 覆盖：create/update/delete/rename-category/set-member/reorder 写操作与
// normalize 排序口径（大类序×1000 + 子概念序）、全景读视图与股票搜索。

const buildDb = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE concepts (
    name TEXT PRIMARY KEY, category TEXT NOT NULL, sort INTEGER NOT NULL, updated_at TEXT NOT NULL)`)
  db.exec(`CREATE TABLE stocks (
    code TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL, board TEXT NOT NULL,
    industry TEXT, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)`)
  db.exec(`CREATE TABLE stock_concepts (
    code TEXT PRIMARY KEY REFERENCES stocks(code) ON DELETE CASCADE,
    concept_name TEXT NOT NULL REFERENCES concepts(name) ON DELETE CASCADE, updated_at TEXT NOT NULL)`)
  db.exec(`CREATE TABLE leader_events (
    code TEXT NOT NULL, concept_name TEXT NOT NULL, exchange TEXT NOT NULL, trade_date TEXT NOT NULL,
    pct REAL NOT NULL, reason TEXT NOT NULL, concept_avg REAL NOT NULL, concept_up_ratio REAL NOT NULL,
    PRIMARY KEY (code, concept_name, trade_date))`)

  const insConcept = db.prepare('INSERT INTO concepts (name, category, sort, updated_at) VALUES (?, ?, ?, ?)')
  insConcept.run('半导体', '半导体', 1001, '2026-01-01 00:00:00')
  insConcept.run('半导体设备', '半导体', 1002, '2026-01-01 00:00:00')
  insConcept.run('芯片', '芯片', 2001, '2026-01-01 00:00:00')
  insConcept.run('存储芯片', '芯片', 2002, '2026-01-01 00:00:00')

  const insStock = db.prepare(
    'INSERT INTO stocks (code, name, exchange, board, industry, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  insStock.run('600519', '贵州茅台', 'SH', 'main', '制造业', 1, '2026-01-01 00:00:00')
  insStock.run('000001', '平安银行', 'SZ', 'main', '金融业', 1, '2026-01-01 00:00:00')
  insStock.run('300999', 'ST示例', 'SZ', 'gem', '制造业', 0, '2026-01-01 00:00:00')

  db.prepare('INSERT INTO stock_concepts (code, concept_name, updated_at) VALUES (?, ?, ?)').run(
    '600519',
    '半导体',
    '2026-01-01 00:00:00'
  )
  db.prepare(
    `INSERT INTO leader_events (code, concept_name, exchange, trade_date, pct, reason, concept_avg, concept_up_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('600519', '半导体', 'SH', '2026-01-05', 10.05, 'limit', 4.2, 0.8)
  return db
}

let db: DatabaseSync

beforeEach(() => {
  db = buildDb()
})

const conceptSort = (name: string): number =>
  (db.prepare('SELECT sort FROM concepts WHERE name = ?').get(name) as { sort: number }).sort

const conceptCategory = (name: string): string =>
  (db.prepare('SELECT category FROM concepts WHERE name = ?').get(name) as { category: string }).category

const rowsOf = (sql: string, ...args: Array<string | number>): unknown[] => db.prepare(sql).all(...args) as unknown[]

describe('createConcept', () => {
  it('已有大类内新增 → 归该大类末位，其余排序不变', () => {
    createConcept(db, { name: '第三代半导体', category: '半导体' })
    expect(conceptSort('第三代半导体')).toBe(1003)
    expect(conceptSort('芯片')).toBe(2001)
    expect(conceptSort('存储芯片')).toBe(2002)
  })

  it('新大类新增 → 追加为大类末位', () => {
    createConcept(db, { name: '人工智能', category: 'AI' })
    expect(conceptSort('人工智能')).toBe(3001)
    const overview = loadConceptOverview(db)
    expect(overview.categories.map((c) => c.name)).toEqual(['半导体', '芯片', 'AI'])
  })

  it('重名 → duplicate', () => {
    expect(() => createConcept(db, { name: '半导体', category: '芯片' })).toThrowError(ConceptAdminError)
  })

  it('失败不落库（事务回滚）', () => {
    expect(() => createConcept(db, { name: '半导体', category: '新大类' })).toThrowError(ConceptAdminError)
    expect(db.prepare("SELECT COUNT(*) AS n FROM concepts WHERE category = '新大类'").get()).toEqual({ n: 0 })
  })
})

describe('updateConcept', () => {
  it('改名：成分与领涨事件随迁，sort 不变', () => {
    updateConcept(db, { name: '半导体', nextName: '半导体链' })
    expect(conceptSort('半导体链')).toBe(1001)
    expect(rowsOf('SELECT concept_name FROM stock_concepts WHERE code = ?', '600519')).toEqual([
      { concept_name: '半导体链' }
    ])
    expect(rowsOf('SELECT concept_name FROM leader_events WHERE code = ?', '600519')).toEqual([
      { concept_name: '半导体链' }
    ])
  })

  it('改名撞已有名 → duplicate', () => {
    expect(() => updateConcept(db, { name: '半导体', nextName: '芯片' })).toThrowError(ConceptAdminError)
  })

  it('换大类 → 归目标大类末位', () => {
    updateConcept(db, { name: '半导体', nextCategory: '芯片' })
    expect(conceptCategory('半导体')).toBe('芯片')
    expect(conceptSort('半导体')).toBe(2003)
    expect(conceptSort('半导体设备')).toBe(1001)
    expect(conceptSort('芯片')).toBe(2001)
  })

  it('改名 + 换大类同时生效', () => {
    updateConcept(db, { name: '半导体', nextName: '半导体链', nextCategory: '芯片' })
    expect(conceptCategory('半导体链')).toBe('芯片')
    expect(conceptSort('半导体链')).toBe(2003)
    expect(rowsOf('SELECT concept_name FROM stock_concepts WHERE code = ?', '600519')).toEqual([
      { concept_name: '半导体链' }
    ])
  })

  it('概念不存在 → not_found', () => {
    expect(() => updateConcept(db, { name: '不存在', nextName: 'x' })).toThrowError(ConceptAdminError)
  })
})

describe('deleteConcept', () => {
  it('级联清除成分与领涨事件', () => {
    deleteConcept(db, '半导体')
    expect(db.prepare("SELECT COUNT(*) AS n FROM concepts WHERE name = '半导体'").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT COUNT(*) AS n FROM stock_concepts WHERE concept_name = '半导体'").get()).toEqual({
      n: 0
    })
    expect(db.prepare("SELECT COUNT(*) AS n FROM leader_events WHERE concept_name = '半导体'").get()).toEqual({
      n: 0
    })
  })

  it('概念不存在 → not_found', () => {
    expect(() => deleteConcept(db, '不存在')).toThrowError(ConceptAdminError)
  })
})

describe('renameCategory', () => {
  it('大类改名保序', () => {
    renameCategory(db, '半导体', '半导体系')
    expect(conceptCategory('半导体')).toBe('半导体系')
    expect(conceptSort('半导体')).toBe(1001)
    const overview = loadConceptOverview(db)
    expect(overview.categories.map((c) => c.name)).toEqual(['半导体系', '芯片'])
  })

  it('并入现有大类 = 合并，目标组追加在尾部', () => {
    renameCategory(db, '半导体', '芯片')
    const overview = loadConceptOverview(db)
    expect(overview.categories.map((c) => c.name)).toEqual(['芯片'])
    const chipConcepts = overview.concepts.filter((c) => c.category === '芯片').map((c) => c.name)
    expect(chipConcepts).toEqual(['芯片', '存储芯片', '半导体', '半导体设备'])
  })

  it('大类不存在 → not_found', () => {
    expect(() => renameCategory(db, '不存在', 'x')).toThrowError(ConceptAdminError)
  })
})

describe('setMember', () => {
  it('划入空概念股 → 建立', () => {
    const result = setMember(db, '000001', '芯片')
    expect(result.prevConcept).toBeNull()
    expect(rowsOf('SELECT concept_name FROM stock_concepts WHERE code = ?', '000001')).toEqual([
      { concept_name: '芯片' }
    ])
  })

  it('划入已有概念股 → 移出原概念（一股一概念），返回先前概念', () => {
    const result = setMember(db, '600519', '芯片')
    expect(result.prevConcept).toBe('半导体')
    expect(rowsOf('SELECT COUNT(*) AS n FROM stock_concepts WHERE concept_name = ?', '半导体')).toEqual([{ n: 0 }])
    expect(rowsOf('SELECT concept_name FROM stock_concepts WHERE code = ?', '600519')).toEqual([
      { concept_name: '芯片' }
    ])
  })

  it('concept=null 移出归类（幂等）', () => {
    expect(setMember(db, '600519', null).prevConcept).toBe('半导体')
    expect(setMember(db, '600519', null).prevConcept).toBeNull()
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_concepts').get()).toEqual({ n: 0 })
  })

  it('股票或概念不存在 → not_found', () => {
    expect(() => setMember(db, '999999', '芯片')).toThrowError(ConceptAdminError)
    expect(() => setMember(db, '000001', '不存在')).toThrowError(ConceptAdminError)
  })
})

describe('reorderConcept', () => {
  it('组内上移 = 与前一个交换', () => {
    reorderConcept(db, '半导体设备', 'up')
    expect(conceptSort('半导体设备')).toBe(1001)
    expect(conceptSort('半导体')).toBe(1002)
    // 其余大类不受影响
    expect(conceptSort('芯片')).toBe(2001)
  })

  it('组首上移 = 幂等', () => {
    reorderConcept(db, '半导体', 'up')
    expect(conceptSort('半导体')).toBe(1001)
    expect(conceptSort('半导体设备')).toBe(1002)
  })

  it('组尾下移 = 幂等；不跨大类交换', () => {
    reorderConcept(db, '半导体设备', 'down')
    expect(conceptSort('半导体设备')).toBe(1002)
    expect(conceptSort('芯片')).toBe(2001)
  })

  it('概念不存在 → not_found', () => {
    expect(() => reorderConcept(db, '不存在', 'up')).toThrowError(ConceptAdminError)
  })
})

describe('loadConceptOverview', () => {
  it('统计带 + 大类分组（按展示序）+ 概念行成分数', () => {
    const overview = loadConceptOverview(db)
    expect(overview.stats).toEqual({ concepts: 4, categories: 2, members: 1, enabledStocks: 2 })
    expect(overview.categories).toEqual([
      { name: '半导体', concepts: 2, members: 1 },
      { name: '芯片', concepts: 2, members: 0 }
    ])
    expect(overview.concepts.map((c) => c.name)).toEqual(['半导体', '半导体设备', '芯片', '存储芯片'])
    expect(overview.concepts.find((c) => c.name === '半导体')?.members).toBe(1)
  })
})

describe('searchStocks', () => {
  it('代码前缀 / 名称包含，启用股优先，带现属概念', () => {
    const byCode = searchStocks(db, '6005')
    expect(byCode.map((s) => s.code)).toEqual(['600519'])
    expect(byCode[0]?.concept).toBe('半导体')

    const byName = searchStocks(db, '银行')
    expect(byName.map((s) => s.code)).toEqual(['000001'])
    expect(byName[0]?.concept).toBeNull()
  })

  it('停用股排后且可见', () => {
    const rows = searchStocks(db, '300')
    expect(rows.map((s) => s.code)).toContain('300999')
    expect(rows.find((s) => s.code === '300999')?.enabled).toBe(false)
  })

  it('LIKE 通配符按字面匹配（不误伤）', () => {
    expect(searchStocks(db, '%')).toEqual([])
  })

  it('限制返回条数', () => {
    const ins = db.prepare(
      'INSERT INTO stocks (code, name, exchange, board, industry, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (let i = 0; i < 30; i++) {
      ins.run(`6007${`${i}`.padStart(2, '0')}`, `股${i}`, 'SH', 'main', null, 1, '2026-01-01 00:00:00')
    }
    expect(searchStocks(db, '6007', 20)).toHaveLength(20)
  })
})
