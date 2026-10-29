// ==================== 概念管理视图类型（环境无关，客户端与服务端共用） ====================
// 概念体系 = market.db 的 concepts（大类×子概念×展示序）+ stock_concepts（一股一概念）；
// 管理页 /admin/concepts 与 /api/admin/concepts 共用本结构，写操作服务端在
// lib/server/market-db/concepts.ts。

/** 未分类虚拟分组键（无落库行，仅页面视图：= 无 stock_concepts 行的股票集合） */
export const UNASSIGNED_CATEGORY = '__unassigned__'

/** 概念行（列表视图；members = 当前成分股数） */
export interface ConceptRow {
  name: string
  category: string
  sort: number
  members: number
}

/** 大类分组信息（按展示序） */
export interface ConceptCategory {
  name: string
  /** 子概念数 */
  concepts: number
  /** 成分股总数 */
  members: number
}

/** 管理页统计带 */
export interface ConceptStats {
  concepts: number
  categories: number
  members: number
  enabledStocks: number
  /** 未归类股票数（无 stock_concepts 行） */
  unassignedStocks: number
}

/** 概念全景（GET /api/admin/concepts 主结构） */
export interface ConceptOverview {
  stats: ConceptStats
  categories: ConceptCategory[]
  concepts: ConceptRow[]
}

/** 成分股行（概念折叠面板展开视图，只读） */
export interface ConceptStockRow {
  code: string
  name: string
  exchange: string
  industry: string | null
  enabled: boolean
}

/** GET 响应：全景 + 按需附带（可重复 concept=，各展开概念的成分表；键 = 概念名或 UNASSIGNED_CATEGORY） */
export interface ConceptAdminData extends ConceptOverview {
  members?: Record<string, ConceptStockRow[]>
}

/** 概念管理写动作（POST body；与 lib/server/schemas.ts 的 zod 定义对齐） */
export type ConceptAdminAction =
  | { action: 'create'; name: string; category: string }
  | { action: 'update'; name: string; nextName?: string; nextCategory?: string }
  | { action: 'delete'; name: string }
  | { action: 'rename-category'; category: string; next: string }
  | { action: 'set-member'; code: string; concept: string | null }
  | { action: 'reorder'; name: string; dir: 'up' | 'down' }
  | { action: 'move'; name: string; category: string; index: number }

/** 写操作结果（set-member 的 prevConcept 供划转 Toast 文案） */
export interface ConceptAdminResult {
  prevConcept?: string | null
}
