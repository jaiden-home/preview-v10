import { DatabaseSync } from 'node:sqlite'
import {
  UNASSIGNED_CATEGORY,
  type ConceptAdminResult,
  type ConceptCategory,
  type ConceptOverview,
  type ConceptRow,
  type ConceptStockRow
} from '../../concepts'
import { marketDbPath } from './db'

// ==================== 概念体系管理域（仅服务端；/admin/concepts 与 /api/admin/concepts 后端） ====================
// market.db 应用侧默认只读（db.ts 单例）；本域是唯一写入口——管理动作经
// withWritableMarketDb 开**短生命周期可写连接**（WAL，与只读单例并存），事务内完成即关。
// 概念/成分变更后由路由层调用 board.invalidateBoardCache() 使领涨看板缓存失效。
//
// 口径说明：
//   - concepts.sort = 大类序 ×1000 + 子概念序（展示序），每次写操作后 normalize 重排全表；
//   - 概念排序 = 组内上下移（reorder）或拖拽至目标大类指定序位（move）；
//   - 成分（stock_concepts，一股一概念）经 setMember 拖拽划转（concept=null = 移出到未分类）；
//   - 概念改名同步改写 stock_concepts / leader_events 的概念名（保留领涨历史）；
//     删除概念则级联清除成分与历史事件（口径同「以当前快照回看历史」，scripts 侧重算亦可）。

/** 单条子概念序上限（normalize 的 ×1000 步长边界） */
const MAX_PER_CATEGORY = 1000

/** 管理域业务错误（路由层映射为 4xx JSON） */
export class ConceptAdminError extends Error {
  constructor(
    readonly code: 'not_found' | 'duplicate' | 'too_many',
    message: string
  ) {
    super(message)
    this.name = 'ConceptAdminError'
  }
}

const nowText = (): string => {
  const d = new Date()
  const p = (x: number): string => `${x}`.padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 短生命周期可写连接（不复用只读单例；WAL 下与只读连接并存，用毕即关） */
export const withWritableMarketDb = <T>(fn: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(marketDbPath())
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    return fn(db)
  } finally {
    db.close()
  }
}

const withTx = <T>(db: DatabaseSync, fn: () => T): T => {
  db.exec('BEGIN IMMEDIATE')
  // 概念改名需先改父行再改子行（stock_concepts/leader_events），延迟外键检查到 COMMIT
  db.exec('PRAGMA defer_foreign_keys = ON')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * 重排全表 sort = 大类序 ×1000 + 子概念序。
 * 大类序 = 按 sort 扫描的首现序（新大类自然追加尾部；换大类概念先推全局尾即归目标组尾）。
 */
const normalizeSort = (db: DatabaseSync): void => {
  const rows = db.prepare('SELECT name, category FROM concepts ORDER BY sort, name').all() as unknown as Array<{
    name: string
    category: string
  }>
  if (rows.length === 0) {
    return
  }
  // 大类序 = sort 扫描首现序；组内超步长则无合法编码（抛错回滚）
  const categoryIndex = new Map<string, number>()
  const categoryCount = new Map<string, number>()
  for (const row of rows) {
    if (!categoryIndex.has(row.category)) {
      categoryIndex.set(row.category, categoryIndex.size)
      categoryCount.set(row.category, 0)
    }
    const count = categoryCount.get(row.category)! + 1
    if (count > MAX_PER_CATEGORY) {
      throw new ConceptAdminError('too_many', 'concept count per category exceeds sort step')
    }
    categoryCount.set(row.category, count)
  }
  const update = db.prepare('UPDATE concepts SET sort = ? WHERE name = ?')
  const countersNow = new Map<string, number>()
  for (const row of rows) {
    const cat = categoryIndex.get(row.category)!
    const next = (countersNow.get(row.category) ?? 0) + 1
    countersNow.set(row.category, next)
    update.run((cat + 1) * MAX_PER_CATEGORY + next, row.name)
  }
}

const conceptExists = (db: DatabaseSync, name: string): boolean =>
  db.prepare('SELECT 1 FROM concepts WHERE name = ?').get(name) != null

/**
 * 新增概念（新大类自动追加为大类末位；已有大类则入该大类末位）。
 * 一级新增撞同名概念（name === category 且该概念在别的大类下）→ **收编**：
 * 该概念改归新建同名大类（追加为大类末位），不再报 duplicate；
 * 真重复（同名同大类）与普通二级撞名仍抛 duplicate。
 */
export const createConcept = (db: DatabaseSync, input: { name: string; category: string }): void => {
  withTx(db, () => {
    const existing = db.prepare('SELECT category FROM concepts WHERE name = ?').get(input.name) as
      { category: string } | undefined
    if (existing != null) {
      if (existing.category === input.category || input.name !== input.category) {
        throw new ConceptAdminError('duplicate', `concept "${input.name}" already exists`)
      }
      const tail = (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM concepts').get() as { s: number }).s
      db.prepare('UPDATE concepts SET category = ?, sort = ?, updated_at = ? WHERE name = ?').run(
        input.category,
        tail,
        nowText(),
        input.name
      )
      normalizeSort(db)
      return
    }
    const sort = (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM concepts').get() as { s: number }).s
    db.prepare('INSERT INTO concepts (name, category, sort, updated_at) VALUES (?, ?, ?, ?)').run(
      input.name,
      input.category,
      sort,
      nowText()
    )
    normalizeSort(db)
  })
}

/** 编辑概念：改名（同步成分与领涨事件的 Concept 名）/ 换大类（归目标大类末位） */
export const updateConcept = (
  db: DatabaseSync,
  input: { name: string; nextName?: string; nextCategory?: string }
): void => {
  withTx(db, () => {
    const row = db.prepare('SELECT name, category FROM concepts WHERE name = ?').get(input.name) as
      { name: string; category: string } | undefined
    if (row == null) {
      throw new ConceptAdminError('not_found', `concept "${input.name}" not found`)
    }
    const nextName = input.nextName ?? row.name
    const nextCategory = input.nextCategory ?? row.category
    if (nextName !== row.name) {
      if (conceptExists(db, nextName)) {
        throw new ConceptAdminError('duplicate', `concept "${nextName}" already exists`)
      }
      db.prepare('UPDATE concepts SET name = ?, updated_at = ? WHERE name = ?').run(nextName, nowText(), row.name)
      db.prepare('UPDATE stock_concepts SET concept_name = ?, updated_at = ? WHERE concept_name = ?').run(
        nextName,
        nowText(),
        row.name
      )
      db.prepare('UPDATE leader_events SET concept_name = ? WHERE concept_name = ?').run(nextName, row.name)
    }
    const renamed = nextName !== row.name
    if (nextCategory !== row.category) {
      // 换大类：先推全局尾，normalize 时即归入目标大类末位
      const tail = (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM concepts').get() as { s: number }).s
      db.prepare('UPDATE concepts SET category = ?, sort = ?, updated_at = ? WHERE name = ?').run(
        nextCategory,
        tail,
        nowText(),
        nextName
      )
      normalizeSort(db)
    } else if (renamed) {
      normalizeSort(db)
    }
  })
}

/** 删除概念：级联清除成分（stock_concepts）与领涨历史事件（leader_events） */
export const deleteConcept = (db: DatabaseSync, name: string): void => {
  withTx(db, () => {
    if (!conceptExists(db, name)) {
      throw new ConceptAdminError('not_found', `concept "${name}" not found`)
    }
    db.prepare('DELETE FROM stock_concepts WHERE concept_name = ?').run(name)
    db.prepare('DELETE FROM leader_events WHERE concept_name = ?').run(name)
    db.prepare('DELETE FROM concepts WHERE name = ?').run(name)
  })
}

/**
 * 大类改名：改新名（尚未存在）= 原位改名保序；与现有大类同名 = 合并——
 * 原组概念按原相对序追加到目标大类尾部（目标组成员保持在前）。
 */
export const renameCategory = (db: DatabaseSync, category: string, next: string): void => {
  withTx(db, () => {
    const rows = db
      .prepare('SELECT name FROM concepts WHERE category = ? ORDER BY sort')
      .all(category) as unknown as Array<{ name: string }>
    if (rows.length === 0) {
      throw new ConceptAdminError('not_found', `category "${category}" not found`)
    }
    const targetExists = category !== next && db.prepare('SELECT 1 FROM concepts WHERE category = ?').get(next) != null
    if (!targetExists) {
      db.prepare('UPDATE concepts SET category = ?, updated_at = ? WHERE category = ?').run(next, nowText(), category)
    } else {
      // 合并：逐行推全局尾（保原相对序），normalize 时归入目标大类尾部
      let tail = (db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM concepts').get() as { s: number }).s
      const update = db.prepare('UPDATE concepts SET category = ?, sort = ?, updated_at = ? WHERE name = ?')
      for (const row of rows) {
        tail += 1
        update.run(next, tail, nowText(), row.name)
      }
    }
    normalizeSort(db)
  })
}

/** 组内上下移（同大类相邻交换 sort；无相邻 = 幂等成功） */
export const reorderConcept = (db: DatabaseSync, name: string, dir: 'up' | 'down'): void => {
  withTx(db, () => {
    const row = db.prepare('SELECT name, category, sort FROM concepts WHERE name = ?').get(name) as
      { name: string; category: string; sort: number } | undefined
    if (row == null) {
      throw new ConceptAdminError('not_found', `concept "${name}" not found`)
    }
    const neighbor = (
      dir === 'up'
        ? db.prepare('SELECT name, sort FROM concepts WHERE category = ? AND sort < ? ORDER BY sort DESC LIMIT 1')
        : db.prepare('SELECT name, sort FROM concepts WHERE category = ? AND sort > ? ORDER BY sort ASC LIMIT 1')
    ).get(row.category, row.sort) as { name: string; sort: number } | undefined
    if (neighbor == null) {
      return
    }
    const upd = db.prepare('UPDATE concepts SET sort = ? WHERE name = ?')
    upd.run(neighbor.sort, row.name)
    upd.run(row.sort, neighbor.name)
  })
}

/**
 * 拖拽排序：将概念移至目标大类的指定序位（同大类换序 / 跨大类换组）。
 * index 按目标大类现有成员（不含被拖概念）序位插入，越界钳制到首/尾；
 * 全表按「大类首现序 ×1000 + 组内序」重写 sort。
 */
export const moveConcept = (db: DatabaseSync, input: { name: string; category: string; index: number }): void => {
  withTx(db, () => {
    const row = db.prepare('SELECT name, category FROM concepts WHERE name = ?').get(input.name) as
      { name: string; category: string } | undefined
    if (row == null) {
      throw new ConceptAdminError('not_found', `concept "${input.name}" not found`)
    }
    if (
      input.category !== row.category &&
      db.prepare('SELECT 1 FROM concepts WHERE category = ?').get(input.category) == null
    ) {
      throw new ConceptAdminError('not_found', `category "${input.category}" not found`)
    }
    const all = db.prepare('SELECT name, category FROM concepts ORDER BY sort, name').all() as unknown as Array<{
      name: string
      category: string
    }>
    // 大类首现序取全量（含被拖概念，保证其原大类即使被拖空也保位）
    const catOrder: string[] = []
    for (const r of all) {
      if (!catOrder.includes(r.category)) {
        catOrder.push(r.category)
      }
    }
    const groups = new Map<string, Array<{ name: string; category: string }>>()
    for (const c of catOrder) {
      groups.set(c, [])
    }
    for (const r of all) {
      if (r.name !== input.name) {
        groups.get(r.category)!.push(r)
      }
    }
    const target = groups.get(input.category)!
    const index = Math.max(0, Math.min(input.index, target.length))
    target.splice(index, 0, { name: input.name, category: input.category })
    // 中间 sort 只需保序（按 catOrder 组序全表递增），×1000 编码统一交 normalizeSort 收口
    const update = db.prepare('UPDATE concepts SET category = ?, sort = ?, updated_at = ? WHERE name = ?')
    let sort = 0
    for (const c of catOrder) {
      for (const member of groups.get(c)!) {
        sort += 1
        update.run(member.category, sort, nowText(), member.name)
      }
    }
    normalizeSort(db)
  })
}

/** 成分划转：一股一概念（concept=null 移出到未分类）；返回先前概念供提示 */
export const setMember = (db: DatabaseSync, code: string, concept: string | null): ConceptAdminResult => {
  return withTx(db, () => {
    if (db.prepare('SELECT 1 FROM stocks WHERE code = ?').get(code) == null) {
      throw new ConceptAdminError('not_found', `stock "${code}" not found`)
    }
    const prev =
      (db.prepare('SELECT concept_name AS c FROM stock_concepts WHERE code = ?').get(code) as { c: string } | undefined)
        ?.c ?? null
    if (concept == null) {
      db.prepare('DELETE FROM stock_concepts WHERE code = ?').run(code)
    } else {
      if (!conceptExists(db, concept)) {
        throw new ConceptAdminError('not_found', `concept "${concept}" not found`)
      }
      db.prepare(
        `INSERT INTO stock_concepts (code, concept_name, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET concept_name = excluded.concept_name, updated_at = excluded.updated_at`
      ).run(code, concept, nowText())
    }
    return { prevConcept: prev }
  })
}

/* —— 读视图（可走只读单例；亦接受可写连接，便于测试内存库） —— */

/** 概念全景：统计带 + 大类分组 + 概念行（含成分数）；大类序 = 概念行首现序（与看板 categories 口径一致） */
export const loadConceptOverview = (db: DatabaseSync): ConceptOverview => {
  const concepts = (
    db
      .prepare(
        `SELECT c.name, c.category, c.sort, COUNT(sc.code) AS members
       FROM concepts c LEFT JOIN stock_concepts sc ON sc.concept_name = c.name
       GROUP BY c.name ORDER BY c.sort`
      )
      .all() as unknown as Array<{ name: string; category: string; sort: number; members: number }>
  ).map<ConceptRow>((r) => ({ name: r.name, category: r.category, sort: r.sort, members: r.members }))
  const categories: ConceptCategory[] = []
  const byName = new Map<string, ConceptCategory>()
  for (const row of concepts) {
    let info = byName.get(row.category)
    if (info == null) {
      info = { name: row.category, concepts: 0, members: 0 }
      byName.set(row.category, info)
      categories.push(info)
    }
    info.concepts += 1
    info.members += row.members
  }
  const stats = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM concepts) AS concepts,
         (SELECT COUNT(DISTINCT category) FROM concepts) AS categories,
         (SELECT COUNT(*) FROM stock_concepts) AS members,
         (SELECT COUNT(*) FROM stocks WHERE enabled = 1) AS enabledStocks,
         (SELECT COUNT(*) FROM stocks s LEFT JOIN stock_concepts sc ON sc.code = s.code
          WHERE sc.code IS NULL AND s.enabled = 1) AS unassignedStocks`
    )
    .get() as {
    concepts: number
    categories: number
    members: number
    enabledStocks: number
    unassignedStocks: number
  }
  return { stats, categories, concepts }
}

/**
 * 概念成分表（只读视图，按代码序）；概念不存在抛 not_found。
 * concept = UNASSIGNED_CATEGORY 为**未分类虚拟分组**（无落库行，仅页面视图）：
 * 返回无 stock_concepts 行的**启用股**集合（停用/退市股不计）。
 */
export const listMembers = (db: DatabaseSync, concept: string): ConceptStockRow[] => {
  if (concept === UNASSIGNED_CATEGORY) {
    const rows = db
      .prepare(
        `SELECT s.code, s.name, s.exchange, s.industry, s.enabled
         FROM stocks s LEFT JOIN stock_concepts sc ON sc.code = s.code
         WHERE sc.code IS NULL AND s.enabled = 1 ORDER BY s.code`
      )
      .all() as unknown as Array<{
      code: string
      name: string
      exchange: string
      industry: string | null
      enabled: number
    }>
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      exchange: r.exchange,
      industry: r.industry,
      enabled: r.enabled === 1
    }))
  }
  if (!conceptExists(db, concept)) {
    throw new ConceptAdminError('not_found', `concept "${concept}" not found`)
  }
  const rows = db
    .prepare(
      `SELECT s.code, s.name, s.exchange, s.industry, s.enabled
       FROM stock_concepts sc JOIN stocks s ON s.code = sc.code
       WHERE sc.concept_name = ? ORDER BY s.code`
    )
    .all(concept) as unknown as Array<{
    code: string
    name: string
    exchange: string
    industry: string | null
    enabled: number
  }>
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    exchange: r.exchange,
    industry: r.industry,
    enabled: r.enabled === 1
  }))
}
