'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactElement } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useLocale } from '@/components/terminal/useLocale'
import TradeToast from '@/components/trading/TradeToast'
import { useNotice } from '@/components/trading/useNotice'
import {
  UNASSIGNED_CATEGORY,
  type ConceptAdminAction,
  type ConceptAdminData,
  type ConceptRow,
  type ConceptStockRow
} from '@/lib/concepts'

/**
 * 概念管理页（/admin/concepts，UI_SPEC §3.17）：维护 market.db 概念体系——
 * 概念/大类增删改与组内排序；概念折叠面板展开查看成分股（只读，成分划转在数据侧维护）。
 * 数据经 /api/admin/concepts（写动作成功后服务端已使领涨看板缓存失效）；
 * 删除概念级联清除成分与领涨历史事件。
 */

type Dialog =
  | { mode: 'create' }
  | { mode: 'edit'; name: string; category: string }
  | { mode: 'rename-category'; category: string }
  | null

/** 编辑弹窗大类选择：现有大类 + 新建项（值为空串） */
const NEW_CATEGORY = ''

/** 大类本地展示序（仅页面视图，localStorage 持久化，不写 market.db） */
const CAT_ORDER_KEY = 'klinecharts-concept-cat-order'

const readLocalCatOrder = (): string[] => {
  if (typeof window === 'undefined') {
    return []
  }
  try {
    const raw = window.localStorage.getItem(CAT_ORDER_KEY)
    const parsed = raw != null ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const writeLocalCatOrder = (order: string[]): void => {
  try {
    window.localStorage.setItem(CAT_ORDER_KEY, JSON.stringify(order))
  } catch {
    // 隐私模式等写入失败：仅当次会话生效
  }
}

/** 拖拽载荷：大类（排序）、子概念（排序/换组）或个股（划转） */
type DragPayload =
  { type: 'category'; category: string } | { type: 'concept'; name: string } | { type: 'stock'; code: string }

const IconBtn = ({
  label,
  onClick,
  disabled,
  path
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  path: string
}) => (
  <button
    type="button"
    className="tb-btn cpt-icon-btn"
    title={label}
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
    draggable={false}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  </button>
)

const CHEVRON_UP = 'M6 15l6-6 6 6'
const CHEVRON_DOWN = 'M6 9l6 6 6-6'
const PENCIL = 'M17 3l4 4L8 20l-5 1 1-5z'
const TRASH = 'M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14'

export default function ConceptAdmin() {
  const { t } = useLocale()

  const [data, setData] = useState<ConceptAdminData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [reloadId, setReloadId] = useState(0)

  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)

  // 拖拽（HTML5 DnD）：大类拖排序（仅本机 localStorage）；子概念拖排序/换组；个股拖到概念行 = 划转、拖到未分类 = 移出
  const dragRef = useRef<DragPayload | null>(null)
  const [dragOver, setDragOver] = useState<{ key: string; pos: 'before' | 'after' } | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)
  const [catDragOver, setCatDragOver] = useState<{ key: string; pos: 'before' | 'after' } | null>(null)
  const [localCatOrder, setLocalCatOrder] = useState<string[]>(readLocalCatOrder)

  const busyRef = useRef(false)

  const { notice, notify } = useNotice()

  // 大类展示序：本地序（localStorage）覆盖库序；未记录的大类（新增）按库序追加尾部
  const orderedCategories = useMemo(() => {
    if (data == null || localCatOrder.length === 0) {
      return data?.categories ?? []
    }
    const rank = new Map(localCatOrder.map((name, i) => [name, i]))
    const known = data.categories.filter((c) => rank.has(c.name)).sort((a, b) => rank.get(a.name)! - rank.get(b.name)!)
    const unknown = data.categories.filter((c) => !rank.has(c.name))
    return [...known, ...unknown]
  }, [data, localCatOrder])

  const withBusy = async (task: () => Promise<void>): Promise<void> => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      await task()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  /** 拉全景（含各展开概念的成分表，concept 可重复多值） */
  const load = async (concepts: Iterable<string>): Promise<ConceptAdminData | null> => {
    const params = new URLSearchParams()
    for (const concept of concepts) {
      params.append('concept', concept)
    }
    const queryString = params.toString()
    const res = await fetch(`/api/admin/concepts${queryString !== '' ? `?${queryString}` : ''}`, {
      cache: 'no-store'
    })
    if (!res.ok) {
      return null
    }
    return (await res.json()) as ConceptAdminData
  }

  // 初载 / 手动重试
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoadError(false)
      const next = await load(selected)
      if (cancelled) {
        return
      }
      if (next == null) {
        setLoadError(true)
        return
      }
      setData(next)
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadId])

  /** 展开/收起概念折叠面板（多开：展开 = 拉全部已展开概念的成分表） */
  const toggle = (name: string): void => {
    const next = new Set(selected)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    setSelected(next)
    void load(next).then((data) => {
      if (data != null) {
        setData(data)
      }
    })
  }

  const refresh = async (concepts: Iterable<string>): Promise<void> => {
    const next = await load(concepts)
    if (next != null) {
      setData(next)
    }
  }

  /** 写动作：POST → 成功返回响应体（调用方负责 Toast 与刷新），失败 Toast 服务端 message */
  const post = async (
    action: ConceptAdminAction
  ): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false }> => {
    const res = await fetch('/api/admin/concepts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(action)
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const message = (json.error as { message?: string } | undefined)?.message
      notify('err', message || t('操作失败，请稍候重试|Action failed, please retry'), 'global')
      return { ok: false }
    }
    return { ok: true, json }
  }

  // —— 概念行操作 ——
  const handleCreate = (name: string, category: string): void =>
    void withBusy(async () => {
      const result = await post({ action: 'create', name, category })
      if (result.ok) {
        notify('ok', t('概念已创建|Concept created'), 'global')
        setDialog(null)
        toggle(name)
      }
    })

  const handleUpdate = (name: string, nextName: string, nextCategory: string): void =>
    void withBusy(async () => {
      const body: Extract<ConceptAdminAction, { action: 'update' }> = { action: 'update', name }
      if (nextName !== name) {
        body.nextName = nextName
      }
      if (nextCategory !== '') {
        body.nextCategory = nextCategory
      }
      const result = await post(body)
      if (result.ok) {
        notify('ok', t('概念已更新|Concept updated'), 'global')
        setDialog(null)
        // 展开集合内改名跟随（不重开其它面板）
        if (selected.has(name)) {
          const next = new Set([...selected].map((n) => (n === name ? nextName : n)))
          setSelected(next)
          await refresh(next)
        } else {
          await refresh(selected)
        }
      }
    })

  const handleDelete = (name: string, members: number): void =>
    void withBusy(async () => {
      if (
        !window.confirm(
          members > 0
            ? t(
                `删除「${name}」将同时移除 ${members} 只成分股的归类与该概念的领涨历史事件，确定？|Deleting "${name}" also removes ${members} member assignments and its leader events. Continue?`
              )
            : t(
                `删除「${name}」将同时清除该概念的领涨历史事件，确定？|Deleting "${name}" also clears its leader events. Continue?`
              )
        )
      ) {
        return
      }
      const result = await post({ action: 'delete', name })
      if (result.ok) {
        notify('ok', t('概念已删除|Concept deleted'), 'global')
        if (selected.has(name)) {
          const next = new Set(selected)
          next.delete(name)
          setSelected(next)
          await refresh(next)
        } else {
          await refresh(selected)
        }
      }
    })

  const handleRenameCategory = (category: string, next: string): void =>
    void withBusy(async () => {
      const merging = data?.categories.some((c) => c.name === next) ?? false
      if (
        merging &&
        !window.confirm(
          t(
            `大类「${next}」已存在，改名将把「${category}」并入其中，确定？|Category "${next}" exists; rename merges "${category}" into it. Continue?`
          )
        )
      ) {
        return
      }
      const result = await post({ action: 'rename-category', category, next })
      if (result.ok) {
        notify('ok', t('大类已更新|Category updated'), 'global')
        setDialog(null)
        await refresh(selected)
      }
    })

  const handleReorder = (name: string, dir: 'up' | 'down'): void =>
    void withBusy(async () => {
      const result = await post({ action: 'reorder', name, dir })
      if (result.ok) {
        await refresh(selected)
      }
    })

  // —— 拖拽（HTML5 DnD；dragover 期间 dataTransfer 不可读，类型经 dragRef 判定） ——

  const startDrag = (event: DragEvent<HTMLElement>, payload: DragPayload): void => {
    dragRef.current = payload
    event.dataTransfer.setData('text/plain', JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'move'
  }

  /** drop 时解析载荷（dataTransfer 可读；异常回退 dragRef） */
  const parseDrag = (event: DragEvent<HTMLElement>): DragPayload | null => {
    const raw = event.dataTransfer.getData('text/plain')
    if (raw !== '') {
      try {
        const parsed = JSON.parse(raw) as DragPayload
        if (parsed != null && (parsed.type === 'concept' || parsed.type === 'stock')) {
          return parsed
        }
      } catch {
        // 非 JSON 载荷 → 回退 dragRef
      }
    }
    return dragRef.current
  }

  const endDrag = (): void => {
    dragRef.current = null
    setDragOver(null)
    setDragOverGroup(null)
    setCatDragOver(null)
  }

  /** 概念拖拽落点：目标行前/后插入或换组；组头落点 = 追加到该组末尾 */
  const handleMoveConcept = (name: string, category: string, index: number): void =>
    void withBusy(async () => {
      const result = await post({ action: 'move', name, category, index })
      if (result.ok) {
        notify('ok', t('概念顺序已更新|Concept order updated'), 'global')
        await refresh(selected)
      }
    })

  /** 大类拖拽落点：仅本机展示序重排（localStorage，不写 market.db） */
  const handleLocalCategoryOrder = (category: string, target: string, pos: 'before' | 'after'): void => {
    const base = orderedCategories.map((c) => c.name).filter((n) => n !== category)
    const idx = base.indexOf(target)
    if (idx < 0) {
      return
    }
    const at = pos === 'after' ? idx + 1 : idx
    const next = [...base.slice(0, at), category, ...base.slice(at)]
    setLocalCatOrder(next)
    writeLocalCatOrder(next)
    notify('ok', t('大类顺序已更新（仅本机）|Category order updated (this browser only)'), 'global')
  }

  /** 个股拖拽落点：划入目标概念（concept=null = 移出到未分类） */
  const handleAssignStock = (code: string, concept: string | null): void =>
    void withBusy(async () => {
      const result = await post({ action: 'set-member', code, concept })
      if (!result.ok) {
        return
      }
      const prev = (result.json.prevConcept as string | null | undefined) ?? null
      notify(
        'ok',
        concept == null
          ? t(`已移出「${prev ?? ''}」至未分类|Removed from "${prev ?? ''}" to uncategorized`)
          : prev != null && prev !== concept
            ? t(`已从「${prev}」移入「${concept}」|Moved from "${prev}" to "${concept}"`)
            : t(`已移入「${concept}」|Added to "${concept}"`),
        'global'
      )
      await refresh(selected)
    })

  /** 概念行/未分类行落点（row head 上的 drop：概念 = 插入该行前/后；个股 = 划入该概念） */
  const dropOnRowHead = (
    event: DragEvent<HTMLDivElement>,
    rowKey: string,
    resolve: (payload: DragPayload) => 'concept-move' | 'stock-assign' | 'ignore'
  ): void => {
    const payload = parseDrag(event)
    if (payload?.type === 'category') {
      // 大类载荷不在行头处理：不拦冒泡，交由组卡 onDrop 排序
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const over = dragOver
    endDrag()
    if (payload == null || over == null || over.key !== rowKey) {
      return
    }
    const kind = resolve(payload)
    if (kind === 'ignore') {
      return
    }
    if (payload.type === 'concept') {
      if (data == null) {
        return
      }
      const category = data.concepts.find((c) => c.name === rowKey)?.category
      if (category == null) {
        return
      }
      // 序位按目标大类全量列表计（不受过滤影响）；after = 目标行之后插入
      const list = data.concepts.filter((c) => c.category === category)
      const targetIdx = list.findIndex((c) => c.name === rowKey)
      if (targetIdx < 0) {
        return
      }
      handleMoveConcept(payload.name, category, targetIdx + (over.pos === 'after' ? 1 : 0))
    } else {
      handleAssignStock(payload.code, rowKey === UNASSIGNED_CATEGORY ? null : rowKey)
    }
  }

  // 每次从 DOM 取反（同首页）：客户端导航往返后主题类随根节点保留
  const toggleTheme = () => {
    const root = document.getElementById('app')
    const next = !root?.classList.contains('dark')
    root?.classList.add('theme-switching')
    root?.classList.toggle('dark', next)
    window.setTimeout(() => root?.classList.remove('theme-switching'), 50)
  }

  // 概念行按搜索过滤（名称/大类包含）
  const filterText = filter.trim()
  const visibleConcepts = useMemo(
    () =>
      data == null
        ? []
        : filterText === ''
          ? data.concepts
          : data.concepts.filter((c) => c.name.includes(filterText) || c.category.includes(filterText)),
    [data, filterText]
  )
  const visibleCategories = useMemo(() => {
    if (filterText === '') {
      return orderedCategories
    }
    return orderedCategories.filter((cat) => visibleConcepts.some((c) => c.category === cat.name))
  }, [orderedCategories, filterText, visibleConcepts])

  // 未分类虚拟分组：仅页面视图（数据侧无落库行），有未归类股票且过滤命中时展示
  const unassignedCount = data?.stats.unassignedStocks ?? 0
  const unassignedVisible = unassignedCount > 0 && (filterText === '' || t('未分类|Uncategorized').includes(filterText))

  // 成分展开体（真实概念行与未分类虚拟行共用；多开下各面板按概念名取各自成分表）
  const memberBodyFor = (key: string): ReactElement => (
    <MemberBody
      members={data?.members?.[key] ?? []}
      busy={busy}
      onStockDragStart={(event, code) => startDrag(event, { type: 'stock', code })}
      onDragEnd={endDrag}
      t={t}
    />
  )

  return (
    <div className="concept-page">
      {/* 单一滚动容器：工具栏为首子元素随内容一起滚动（不固定悬浮） */}
      <div className="concept-scroll">
        <div className="toolbar">
          <div className="toolbar-item">
            <Link className="tb-btn tb-clear" href="/">
              ← {t('首页|Home')}
            </Link>
          </div>
          <span className="home-brand">{t('概念管理|Concept Admin')}</span>
          <ThemeToggle t={t} onToggle={toggleTheme} />
        </div>

        {loadError ? (
          <div className="trade-loading">
            {t('加载失败|Failed to load')}
            <button type="button" className="tb-btn" onClick={() => setReloadId((v) => v + 1)}>
              {t('重试|Retry')}
            </button>
          </div>
        ) : data == null ? (
          <div className="trade-loading">{t('加载中|Loading')}…</div>
        ) : (
          <div className="concept-main">
            {/* 卡 1：统计带 + 概念体系工具行 */}
            <section className="trade-card">
              <div className="cpt-stats">
                <span className="screen-stat">
                  <span className="screen-stat-k">{t('概念总数|Concepts')}</span>
                  <span className="screen-stat-v num">{data.stats.concepts}</span>
                </span>
                <span className="screen-stat">
                  <span className="screen-stat-k">{t('大类|Categories')}</span>
                  <span className="screen-stat-v num">{data.stats.categories}</span>
                </span>
                <span className="screen-stat">
                  <span className="screen-stat-k">{t('已归类成分股|Assigned stocks')}</span>
                  <span className="screen-stat-v num">{data.stats.members}</span>
                </span>
                <span className="screen-stat">
                  <span className="screen-stat-k">{t('启用股票|Enabled stocks')}</span>
                  <span className="screen-stat-v num">{data.stats.enabledStocks}</span>
                </span>
                <span className="screen-stat">
                  <span className="screen-stat-k">{t('未分类|Unassigned')}</span>
                  <span className="screen-stat-v num">{data.stats.unassignedStocks}</span>
                </span>
              </div>
              <div className="cpt-list-head">
                <span className="cpt-title">{t('概念体系|Concept system')}</span>
                <span className="cpt-sub num">{data.stats.concepts}</span>
                <input
                  className="cpt-filter"
                  type="search"
                  placeholder={t('搜索概念或大类|Search concept or category')}
                  aria-label={t('搜索概念或大类|Search concept or category')}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
                <button
                  type="button"
                  className="cpt-add-btn"
                  onClick={() => setDialog({ mode: 'create' })}
                  disabled={busy}
                >
                  + {t('新增|Add')}
                </button>
              </div>
            </section>

            {/* 大类卡片网格：未分类虚拟卡居首，其后每大类一张卡（概念折叠面板，展开即成分股） */}
            <div className="cpt-groups">
              {visibleCategories.length === 0 && !unassignedVisible && (
                <div className="cpt-empty">{t('无匹配概念|No matching concepts')}</div>
              )}

              {/* 未分类虚拟分组：无 stock_concepts 行的启用股（仅页面视图，数据侧无此大类） */}
              {unassignedVisible && (
                <div className="cpt-group virtual">
                  <div className="cpt-group-head">
                    <span className="cpt-group-name">{t('未分类|Uncategorized')}</span>
                    <span className="cpt-group-meta num">
                      {t(`${unassignedCount} 只未归类成分|${unassignedCount} unassigned stocks`)}
                    </span>
                  </div>
                  <div className={`cpt-row${selected.has(UNASSIGNED_CATEGORY) ? ' open' : ''}`}>
                    <div
                      className={`cpt-row-head${dragOver?.key === UNASSIGNED_CATEGORY ? ` drag-${dragOver.pos}` : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-expanded={selected.has(UNASSIGNED_CATEGORY)}
                      onClick={() => toggle(UNASSIGNED_CATEGORY)}
                      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          toggle(UNASSIGNED_CATEGORY)
                        }
                      }}
                      onDragOver={(event) => {
                        event.stopPropagation()
                        if (dragRef.current?.type !== 'stock') {
                          return
                        }
                        event.preventDefault()
                        const rect = event.currentTarget.getBoundingClientRect()
                        setDragOver({
                          key: UNASSIGNED_CATEGORY,
                          pos: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                        })
                      }}
                      onDragLeave={() => setDragOver((cur) => (cur?.key === UNASSIGNED_CATEGORY ? null : cur))}
                      onDrop={(event) =>
                        dropOnRowHead(event, UNASSIGNED_CATEGORY, (payload) =>
                          payload.type === 'stock' ? 'stock-assign' : 'ignore'
                        )
                      }
                    >
                      <span
                        className={`cpt-row-chevron${selected.has(UNASSIGNED_CATEGORY) ? ' open' : ''}`}
                        aria-hidden="true"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                      <span className="cpt-row-name">{t('未分类股票|Uncategorized stocks')}</span>
                      <span className="cpt-row-members" title={t('成分股数|Member count')}>
                        {unassignedCount}
                      </span>
                    </div>
                    {selected.has(UNASSIGNED_CATEGORY) && memberBodyFor(UNASSIGNED_CATEGORY)}
                  </div>
                </div>
              )}

              {visibleCategories.map((cat) => (
                <div
                  key={cat.name}
                  className={`cpt-group${dragOverGroup === cat.name ? ' drag-over' : ''}${
                    catDragOver?.key === cat.name ? ` cat-${catDragOver.pos}` : ''
                  }`}
                  onDragOver={(event) => {
                    const payload = dragRef.current
                    if (payload == null) {
                      return
                    }
                    if (payload.type === 'category') {
                      // 大类拖拽：目标卡上/下半区 = 移到该大类前/后
                      if (payload.category === cat.name) {
                        return
                      }
                      event.preventDefault()
                      event.stopPropagation()
                      const rect = event.currentTarget.getBoundingClientRect()
                      setCatDragOver({
                        key: cat.name,
                        pos: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                      })
                      return
                    }
                    if (payload.type !== 'concept' || payload.name === cat.name) {
                      return
                    }
                    event.preventDefault()
                    event.stopPropagation()
                    setDragOverGroup(cat.name)
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      return
                    }
                    setDragOverGroup((cur) => (cur === cat.name ? null : cur))
                    setCatDragOver((cur) => (cur?.key === cat.name ? null : cur))
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    const payload = parseDrag(event)
                    const over = catDragOver
                    endDrag()
                    if (payload == null) {
                      return
                    }
                    if (payload.type === 'category') {
                      if (over == null || over.key !== cat.name) {
                        return
                      }
                      // 大类排序仅本机（localStorage），不写库
                      handleLocalCategoryOrder(payload.category, cat.name, over.pos)
                      return
                    }
                    if (payload.type !== 'concept') {
                      return
                    }
                    // 概念落点 = 追加到该大类末尾（index 由服务端钳制）
                    const count = data.concepts.filter((c) => c.category === cat.name).length
                    handleMoveConcept(payload.name, cat.name, count)
                  }}
                >
                  <div
                    className="cpt-group-head"
                    draggable={!busy}
                    onDragStart={(event) => startDrag(event, { type: 'category', category: cat.name })}
                    onDragEnd={endDrag}
                  >
                    <span className="cpt-group-name">{cat.name}</span>
                    <span className="cpt-group-meta num">
                      {t(
                        `${cat.concepts} 个概念 / ${cat.members} 只成分|${cat.concepts} concepts / ${cat.members} stocks`
                      )}
                    </span>
                    <IconBtn
                      label={t('大类改名|Rename category')}
                      path={PENCIL}
                      onClick={() => setDialog({ mode: 'rename-category', category: cat.name })}
                      disabled={busy}
                    />
                  </div>
                  {visibleConcepts
                    .filter((c) => c.category === cat.name)
                    .map((c) => {
                      const open = selected.has(c.name)
                      return (
                        <div key={c.name} className={`cpt-row${open ? ' open' : ''}`}>
                          <div
                            className={`cpt-row-head${dragOver?.key === c.name ? ` drag-${dragOver.pos}` : ''}`}
                            role="button"
                            tabIndex={0}
                            aria-expanded={open}
                            draggable={!busy}
                            onClick={() => toggle(c.name)}
                            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                toggle(c.name)
                              }
                            }}
                            onDragStart={(event) => startDrag(event, { type: 'concept', name: c.name })}
                            onDragEnd={endDrag}
                            onDragOver={(event) => {
                              const payload = dragRef.current
                              // 大类载荷不在行头处理（冒泡至组卡排序）
                              if (payload == null || payload.type === 'category') {
                                return
                              }
                              event.stopPropagation()
                              if (payload.type === 'concept' && payload.name === c.name) {
                                return
                              }
                              event.preventDefault()
                              const rect = event.currentTarget.getBoundingClientRect()
                              setDragOver({
                                key: c.name,
                                pos: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                              })
                            }}
                            onDragLeave={() => setDragOver((cur) => (cur?.key === c.name ? null : cur))}
                            onDrop={(event) =>
                              dropOnRowHead(event, c.name, (payload) =>
                                payload.type === 'concept' && payload.name === c.name
                                  ? 'ignore'
                                  : payload.type === 'concept'
                                    ? 'concept-move'
                                    : 'stock-assign'
                              )
                            }
                          >
                            <span className={`cpt-row-chevron${open ? ' open' : ''}`} aria-hidden="true">
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M9 5l7 7-7 7" />
                              </svg>
                            </span>
                            <span className="cpt-row-name">{c.name}</span>
                            <span className="cpt-row-members" title={t('成分股数|Member count')}>
                              {c.members}
                            </span>
                            <span
                              className="cpt-row-actions"
                              onClick={(event) => event.stopPropagation()}
                              role="presentation"
                            >
                              <IconBtn
                                label={t('上移|Move up')}
                                path={CHEVRON_UP}
                                onClick={() => handleReorder(c.name, 'up')}
                                disabled={busy}
                              />
                              <IconBtn
                                label={t('下移|Move down')}
                                path={CHEVRON_DOWN}
                                onClick={() => handleReorder(c.name, 'down')}
                                disabled={busy}
                              />
                              <IconBtn
                                label={t('编辑|Edit')}
                                path={PENCIL}
                                onClick={() => setDialog({ mode: 'edit', name: c.name, category: c.category })}
                                disabled={busy}
                              />
                              <IconBtn
                                label={t('删除|Delete')}
                                path={TRASH}
                                onClick={() => handleDelete(c.name, c.members)}
                                disabled={busy}
                              />
                            </span>
                          </div>
                          {open && memberBodyFor(c.name)}
                        </div>
                      )
                    })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 新增 / 编辑概念 / 大类改名 弹窗（复用 .modal 范式） */}
      {dialog != null && (
        <ConceptDialog
          key={
            dialog.mode === 'create'
              ? 'create'
              : dialog.mode === 'edit'
                ? `edit:${dialog.name}`
                : `cat:${dialog.category}`
          }
          dialog={dialog}
          categories={data?.categories.map((c) => c.name) ?? []}
          concepts={data?.concepts ?? []}
          busy={busy}
          onCancel={() => setDialog(null)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onRenameCategory={handleRenameCategory}
        />
      )}

      {notice != null && <TradeToast notice={notice} />}
    </div>
  )
}

/** 成分展开体（只读列表 + 个股拖拽源；独立组件避免渲染函数内访问 ref 触发 compiler lint） */
const MemberBody = ({
  members,
  busy,
  onStockDragStart,
  onDragEnd,
  t
}: {
  members: ConceptStockRow[]
  busy: boolean
  onStockDragStart: (event: DragEvent<HTMLElement>, code: string) => void
  onDragEnd: () => void
  t: (text: string) => string
}): ReactElement => (
  <div className="cpt-row-body">
    {members.length === 0 ? (
      <div className="trade-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
        </svg>
        <div className="trade-empty-title">{t('暂无成分股|No members yet')}</div>
        <div className="trade-empty-sub">{t('该概念暂未归入股票|No stocks assigned to this concept yet')}</div>
      </div>
    ) : (
      <div className="cpt-members">
        {members.map((stock) => (
          <div
            key={stock.code}
            className="cpt-member-row"
            draggable={!busy}
            onDragStart={(event) => onStockDragStart(event, stock.code)}
            onDragEnd={onDragEnd}
            title={t('拖拽到概念行划入|Drag onto a concept row to assign')}
          >
            <span className="cpt-member-code num">{stock.code}</span>
            <span className={`cpt-member-name${stock.enabled ? '' : ' cpt-halt'}`}>
              {stock.name}
              {!stock.enabled && <span className="cpt-halt-tag">{t('停|Halted')}</span>}
            </span>
            <span className="cpt-member-industry">{stock.industry ?? '--'}</span>
          </div>
        ))}
      </div>
    )}
  </div>
)

/** 新增（一级大类 / 二级概念）/ 编辑概念 / 大类改名弹窗（复用 .modal 壳；大类随首个子概念建立） */
const ConceptDialog = ({
  dialog,
  categories,
  concepts,
  busy,
  onCancel,
  onCreate,
  onUpdate,
  onRenameCategory
}: {
  dialog: Exclude<Dialog, null>
  categories: string[]
  concepts: ConceptRow[]
  busy: boolean
  onCancel: () => void
  onCreate: (name: string, category: string) => void
  onUpdate: (name: string, nextName: string, nextCategory: string) => void
  onRenameCategory: (category: string, next: string) => void
}): ReactElement => {
  const { t } = useLocale()
  // 新增弹窗的一级/二级切换（单入口「+ 新增」，默认二级概念）
  const [kind, setKind] = useState<'concept' | 'category'>('concept')
  const initialCategory = dialog.mode === 'edit' ? dialog.category : (categories[0] ?? '')
  const [name, setName] = useState(dialog.mode === 'edit' ? dialog.name : '')
  const [category, setCategory] = useState(dialog.mode === 'rename-category' ? dialog.category : initialCategory)
  const [custom, setCustom] = useState('')
  const isCustom = category === NEW_CATEGORY

  const effectiveCategory = isCustom ? custom.trim() : category
  // 一级新增 = 仅大类名（以同名概念落库，大类由概念派生）；二级新增/编辑 = 概念名 + 所属大类
  const addCategory = dialog.mode === 'create' && kind === 'category'
  // 撞名本地预检（与服务端口径一致）：一级 = 同名且已在同名大类（真重复；在别处则收编）；二级/编辑 = 概念名（编辑自身原名除外）
  const typedName = addCategory ? custom.trim() : name.trim()
  const existingRow =
    dialog.mode !== 'rename-category' && typedName !== '' && typedName !== (dialog.mode === 'edit' ? dialog.name : '')
      ? concepts.find((c) => c.name === typedName)
      : undefined
  const dupName = existingRow != null && (addCategory ? existingRow.category === typedName : true) ? typedName : null
  // 一级收编：同名概念现挂在别的大类，保存后将归入新建同名大类
  const adoptFrom =
    addCategory && existingRow != null && existingRow.category !== typedName ? existingRow.category : null
  const nameOk = name.trim() !== ''
  const categoryOk = effectiveCategory !== ''
  const valid = addCategory ? custom.trim() !== '' && dupName == null : nameOk && categoryOk && dupName == null
  const dirty = dialog.mode === 'edit' ? name.trim() !== dialog.name || effectiveCategory !== dialog.category : true

  const title =
    dialog.mode === 'create'
      ? addCategory
        ? t('新增大类|New category')
        : t('新增概念|New concept')
      : dialog.mode === 'edit'
        ? t('编辑概念|Edit concept')
        : t('大类改名|Rename category')

  const submit = (): void => {
    if (dialog.mode === 'create') {
      // 一级：大类以同名概念建立（无独立大类表，可后续改名或继续添加子概念）
      onCreate(addCategory ? custom.trim() : name.trim(), addCategory ? custom.trim() : effectiveCategory)
    } else if (dialog.mode === 'edit') {
      onUpdate(dialog.name, name.trim(), effectiveCategory)
    } else {
      onRenameCategory(dialog.category, effectiveCategory)
    }
  }

  const enterSubmit = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && valid && dirty && !busy) {
      submit()
    }
  }

  return (
    <div className="modal-mask open" role="presentation" onClick={onCancel}>
      <div
        className="modal cpt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button type="button" className="modal-close" aria-label={t('关闭|Close')} onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="modal-body cpt-dialog-body">
          {dialog.mode === 'create' && (
            <div className="period-group cpt-kind-group" role="tablist" aria-label={t('新增层级|Add level')}>
              <button
                type="button"
                className={`tb-btn${kind === 'concept' ? ' active' : ''}`}
                role="tab"
                aria-selected={kind === 'concept'}
                onClick={() => setKind('concept')}
              >
                {t('二级·概念|Concept')}
              </button>
              <button
                type="button"
                className={`tb-btn${kind === 'category' ? ' active' : ''}`}
                role="tab"
                aria-selected={kind === 'category'}
                onClick={() => setKind('category')}
              >
                {t('一级·大类|Category')}
              </button>
            </div>
          )}

          {addCategory ? (
            <>
              <label className="cpt-field">
                <span className="cpt-field-label">{t('大类名称|Category name')}</span>
                <input
                  className="cpt-input"
                  value={custom}
                  maxLength={30}
                  autoFocus
                  onChange={(event) => setCustom(event.target.value)}
                  onKeyDown={enterSubmit}
                />
              </label>
              <span className="cpt-field-hint">
                {t(
                  '大类以同名概念建立，可后续改名或继续添加子概念|Created with a same-named concept; rename or add more later'
                )}
              </span>
              {adoptFrom != null && (
                <span className="cpt-field-hint">
                  {t(
                    `已存在同名概念（现属「${adoptFrom}」），保存后将归入新大类|Same-named concept found (in "${adoptFrom}"); it will be moved into the new category`
                  )}
                </span>
              )}
              {dupName != null && (
                <span className="cpt-field-hint cpt-field-error">
                  {t(
                    `已存在同名概念「${dupName}」，请先改名或换一个名称|Concept "${dupName}" already exists; rename it or use another name`
                  )}
                </span>
              )}
            </>
          ) : (
            <>
              {dialog.mode !== 'rename-category' && (
                <label className="cpt-field">
                  <span className="cpt-field-label">{t('概念名称|Concept name')}</span>
                  <input
                    className="cpt-input"
                    value={name}
                    maxLength={30}
                    autoFocus
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={enterSubmit}
                  />
                </label>
              )}
              <label className="cpt-field">
                <span className="cpt-field-label">{t('所属大类|Category')}</span>
                {dialog.mode === 'rename-category' ? (
                  <input
                    className="cpt-input"
                    value={category}
                    maxLength={30}
                    autoFocus
                    onChange={(event) => setCategory(event.target.value)}
                    onKeyDown={enterSubmit}
                  />
                ) : (
                  <select className="cpt-input" value={category} onChange={(event) => setCategory(event.target.value)}>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value={NEW_CATEGORY}>+ {t('新建大类…|New category…')}</option>
                  </select>
                )}
              </label>
              {isCustom && dialog.mode !== 'rename-category' && (
                <label className="cpt-field">
                  <span className="cpt-field-label">{t('新大类名称|New category name')}</span>
                  <input
                    className="cpt-input"
                    value={custom}
                    maxLength={30}
                    autoFocus
                    onChange={(event) => setCustom(event.target.value)}
                    onKeyDown={enterSubmit}
                  />
                </label>
              )}
              {dupName != null && (
                <span className="cpt-field-hint cpt-field-error">
                  {t(
                    `已存在同名概念「${dupName}」，请换一个名称|Concept "${dupName}" already exists; use another name`
                  )}
                </span>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="tb-btn modal-btn" onClick={onCancel} disabled={busy}>
            {t('取消|Cancel')}
          </button>
          <button
            type="button"
            className="tb-btn modal-btn primary"
            onClick={submit}
            disabled={busy || !valid || !dirty}
          >
            {t('保存|Save')}
          </button>
        </div>
      </div>
    </div>
  )
}
