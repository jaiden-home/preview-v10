import type { NextRequest } from 'next/server'
import { allowRequest, jsonError, jsonOk, requestIdOf } from '@/lib/server/api'
import { requestLogger } from '@/lib/server/logger'
import type { ConceptAdminData, ConceptAdminResult, ConceptStockRow } from '@/lib/concepts'
import { invalidateBoardCache } from '@/lib/server/market-db/board'
import {
  ConceptAdminError,
  createConcept,
  deleteConcept,
  loadConceptOverview,
  listMembers,
  moveConcept,
  renameCategory,
  reorderConcept,
  setMember,
  updateConcept,
  withWritableMarketDb
} from '@/lib/server/market-db/concepts'
import { getMarketDb, marketDbExists } from '@/lib/server/market-db/db'
import { conceptAdminSchema } from '@/lib/server/schemas'

export const dynamic = 'force-dynamic'

// ==================== 概念体系管理接口（/admin/concepts 页后端） ====================
// GET：概念全景（统计 + 大类 + 概念行），?concept= 附成分表（只读；__unassigned__ = 未分类虚拟键）。
// POST：写动作（create/update/delete/rename-category/reorder/move/set-member），
//       短生命周期可写连接事务内完成，成功后使领涨看板缓存失效。

/** GET：管理页全景数据（只读单例；无进程缓存——数据量小且要求写后即时一致） */
export async function GET(request: NextRequest) {
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  if (!marketDbExists()) {
    return jsonError(503, 'market_db_missing', 'market snapshot database not provisioned')
  }
  const concepts = new URL(request.url).searchParams.getAll('concept')
  const log = requestLogger(requestIdOf(request))
  try {
    const db = getMarketDb()
    const data: ConceptAdminData = { ...loadConceptOverview(db) }
    if (concepts.length > 0) {
      const members: Record<string, ConceptStockRow[]> = {}
      for (const concept of concepts) {
        members[concept] = listMembers(db, concept)
      }
      data.members = members
    }
    return jsonOk(data)
  } catch (error) {
    if (error instanceof ConceptAdminError) {
      return jsonError(404, error.code, error.message)
    }
    log.error({ err: String(error) }, 'concept admin load failed')
    return jsonError(502, 'concept_admin_error', 'concept admin data temporarily unavailable')
  }
}

/** POST：写动作（可写连接事务内完成 → 失效看板缓存） */
export async function POST(request: NextRequest) {
  if (!allowRequest(request)) {
    return jsonError(429, 'rate_limited', 'too many requests')
  }
  if (!marketDbExists()) {
    return jsonError(503, 'market_db_missing', 'market snapshot database not provisioned')
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'invalid_params', 'invalid json body')
  }
  const parsed = conceptAdminSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(400, 'invalid_params', parsed.error.issues[0]?.message ?? 'invalid body')
  }
  const log = requestLogger(requestIdOf(request))
  try {
    const result = withWritableMarketDb((db): Record<string, unknown> | ConceptAdminResult => {
      const action = parsed.data
      switch (action.action) {
        case 'create':
          createConcept(db, action)
          return {}
        case 'update':
          updateConcept(db, action)
          return {}
        case 'delete':
          deleteConcept(db, action.name)
          return {}
        case 'rename-category':
          renameCategory(db, action.category, action.next)
          return {}
        case 'reorder':
          reorderConcept(db, action.name, action.dir)
          return {}
        case 'move':
          moveConcept(db, action)
          return {}
        case 'set-member':
          return setMember(db, action.code, action.concept)
      }
    })
    invalidateBoardCache()
    return jsonOk(result)
  } catch (error) {
    if (error instanceof ConceptAdminError) {
      const status = error.code === 'not_found' ? 404 : 409
      return jsonError(status, error.code, error.message)
    }
    log.error({ err: String(error), body: parsed.data }, 'concept admin write failed')
    return jsonError(502, 'concept_admin_error', 'concept admin write temporarily unavailable')
  }
}
