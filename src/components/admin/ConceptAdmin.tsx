'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useLocale } from '@/components/terminal/useLocale'
import TradeToast from '@/components/trading/TradeToast'
import { useNotice } from '@/components/trading/useNotice'
import type { ConceptAdminAction, ConceptAdminData, ConceptStockRow } from '@/lib/concepts'

/**
 * 概念管理页（/admin/concepts，UI_SPEC §3.17）：维护 market.db 概念体系——
 * 概念/大类增删改与组内排序、成分股划转（一股一概念）。数据经 /api/admin/concepts
 * （写动作成功后服务端已使领涨看板缓存失效）；删除概念级联清除成分与领涨历史事件。
 */

type Dialog =
  | { mode: 'create' }
  | { mode: 'edit'; name: string; category: string }
  | { mode: 'rename-category'; category: string }
  | null

/** 编辑弹窗大类选择：现有大类 + 新建项（值为空串） */
const NEW_CATEGORY = ''

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

  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)

  // 成分面板股票搜索（300ms 防抖，与 SymbolPicker 一致）
  const [query, setQuery] = useState('')
  const busyRef = useRef(false)

  const { notice, notify } = useNotice()

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

  /** 拉全景（含选中概念成分表与在途搜索结果） */
  const load = async (concept: string | null, q: string): Promise<ConceptAdminData | null> => {
    const params = new URLSearchParams()
    if (concept != null && concept !== '') {
      params.set('concept', concept)
    }
    if (q !== '') {
      params.set('q', q)
    }
    const queryString = params.toString()
    const search = queryString !== '' ? `?${queryString}` : ''
    const res = await fetch(`/api/admin/concepts${search}`, { cache: 'no-store' })
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
      const next = await load(selected, '')
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

  // 成分面板搜索防抖（只刷 stocks，不动全景）
  const q = query.trim()
  useEffect(() => {
    if (selected == null) {
      return
    }
    const timer = setTimeout(() => {
      void load(selected, q).then((next) => {
        if (next != null) {
          setData(next)
        }
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [q, selected])

  /** 选中概念（拉成分表；清空搜索） */
  const select = (name: string): void => {
    setSelected(name)
    setQuery('')
    void load(name, '').then((next) => {
      if (next != null) {
        setData(next)
      }
    })
  }

  const refresh = async (concept: string | null): Promise<void> => {
    const next = await load(concept, q)
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
        select(name)
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
        const nextSelected = selected === name ? nextName : selected
        if (selected === name) {
          setSelected(nextName)
        }
        await refresh(nextSelected)
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
        if (selected === name) {
          setSelected(null)
        }
        await refresh(selected === name ? null : selected)
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

  const handleRemoveMember = (stock: ConceptStockRow): void =>
    void withBusy(async () => {
      const result = await post({ action: 'set-member', code: stock.code, concept: null })
      if (result.ok) {
        notify('ok', t(`已移出「${stock.name}」|Removed "${stock.name}"`), 'global')
        await refresh(selected)
      }
    })

  const handleAddMember = (stock: ConceptStockRow, concept: string): void =>
    void withBusy(async () => {
      const result = await post({ action: 'set-member', code: stock.code, concept })
      if (!result.ok) {
        return
      }
      const prev = (result.json.prevConcept as string | null | undefined) ?? null
      notify(
        'ok',
        prev != null && prev !== concept
          ? t(`已从「${prev}」移入「${concept}」|Moved from "${prev}" to "${concept}"`)
          : t(`已划入「${concept}」|Added to "${concept}"`),
        'global'
      )
      setQuery('')
      await refresh(selected)
    })

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
    if (data == null) {
      return []
    }
    if (filterText === '') {
      return data.categories
    }
    return data.categories.filter((cat) => visibleConcepts.some((c) => c.category === cat.name))
  }, [data, filterText, visibleConcepts])

  const selectedMembers = data?.members ?? []
  const stockPicks = data?.stocks ?? []

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
            {/* 卡 1：统计带 */}
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
              </div>
            </section>

            <div className="cpt-body">
              {/* 卡 2：概念体系（大类分组列表） */}
              <section className="trade-card cpt-list">
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
                    + {t('新增概念|New concept')}
                  </button>
                </div>
                <div className="cpt-groups">
                  {visibleCategories.length === 0 && (
                    <div className="cpt-empty">{t('无匹配概念|No matching concepts')}</div>
                  )}
                  {visibleCategories.map((cat) => (
                    <div key={cat.name} className="cpt-group">
                      <div className="cpt-group-head">
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
                        .map((c) => (
                          <div key={c.name} className={`cpt-row${selected === c.name ? ' active' : ''}`}>
                            <button
                              type="button"
                              className="cpt-row-name"
                              onClick={() => select(c.name)}
                              title={t('查看成分|View members')}
                            >
                              {c.name}
                            </button>
                            <span className="cpt-row-members num" title={t('成分股数|Member count')}>
                              {c.members}
                            </span>
                            <span className="cpt-row-actions">
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
                        ))}
                    </div>
                  ))}
                </div>
              </section>

              {/* 卡 3：成分管理（选中概念） */}
              {selected != null && (
                <section className="trade-card cpt-members">
                  <div className="cpt-members-head">
                    <span className="cpt-members-title">{selected}</span>
                    <span className="cpt-members-sub">
                      {(() => {
                        const cat = data.concepts.find((c) => c.name === selected)?.category
                        return cat ?? ''
                      })()}
                    </span>
                    <span className="cpt-members-count num">{selectedMembers.length}</span>
                    <button
                      type="button"
                      className="tb-btn tb-clear"
                      onClick={() => {
                        setSelected(null)
                        setQuery('')
                      }}
                    >
                      × {t('关闭|Close')}
                    </button>
                  </div>

                  <div className="cpt-pick">
                    <input
                      className="cpt-filter"
                      type="search"
                      placeholder={t('搜索代码或名称划入成分|Search code or name to assign')}
                      aria-label={t('搜索代码或名称划入成分|Search code or name to assign')}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {q !== '' && (
                      <div className="cpt-pick-list">
                        {stockPicks.length === 0 && <div className="cpt-pick-empty">{t('无结果|No results')}</div>}
                        {stockPicks.map((stock) => (
                          <div key={stock.code} className="cpt-pick-row">
                            <span className="cpt-pick-code num">{stock.code}</span>
                            <span className={`cpt-pick-name${stock.enabled ? '' : ' halt'}`}>{stock.name}</span>
                            <span className="cpt-pick-concept" title={t('现属概念|Current concept')}>
                              {stock.concept ?? t('未归类|Unassigned')}
                            </span>
                            <button
                              type="button"
                              className="tb-btn cpt-pick-add"
                              onClick={() => handleAddMember(stock, selected)}
                              disabled={busy || stock.concept === selected}
                            >
                              {stock.concept === selected ? t('已在此概念|Already here') : t('划入|Assign')}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedMembers.length === 0 ? (
                    <div className="trade-empty">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <circle cx="11" cy="11" r="7" />
                        <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
                      </svg>
                      <div className="trade-empty-title">{t('暂无成分股|No members yet')}</div>
                      <div className="trade-empty-sub">{t('搜索代码或名称划入成分|Search code or name to assign')}</div>
                    </div>
                  ) : (
                    <div className="trade-table-wrap">
                      <table className="trade-table">
                        <thead>
                          <tr>
                            <th>{t('代码|Code')}</th>
                            <th>{t('名称|Name')}</th>
                            <th>{t('交易所|Exchange')}</th>
                            <th>{t('行业|Industry')}</th>
                            <th aria-label={t('操作|Actions')} />
                          </tr>
                        </thead>
                        <tbody>
                          {selectedMembers.map((stock) => (
                            <tr key={stock.code}>
                              <td className="num cell-code">{stock.code}</td>
                              <td className={stock.enabled ? 'cell-symbol' : 'cell-symbol cpt-halt'}>
                                {stock.name}
                                {!stock.enabled && <span className="cpt-halt-tag">{t('停|Halted')}</span>}
                              </td>
                              <td className="num">{stock.exchange}</td>
                              <td>{stock.industry ?? '--'}</td>
                              <td className="cpt-cell-action">
                                <button
                                  type="button"
                                  className="tb-btn cpt-remove-btn"
                                  onClick={() => handleRemoveMember(stock)}
                                  disabled={busy}
                                >
                                  {t('移出|Remove')}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
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

/** 概念/大类编辑弹窗（名称 + 大类选择，支持新建大类） */
const ConceptDialog = ({
  dialog,
  categories,
  busy,
  onCancel,
  onCreate,
  onUpdate,
  onRenameCategory
}: {
  dialog: Exclude<Dialog, null>
  categories: string[]
  busy: boolean
  onCancel: () => void
  onCreate: (name: string, category: string) => void
  onUpdate: (name: string, nextName: string, nextCategory: string) => void
  onRenameCategory: (category: string, next: string) => void
}): ReactElement => {
  const { t } = useLocale()
  const initialCategory = dialog.mode === 'edit' ? dialog.category : (categories[0] ?? '')
  const [name, setName] = useState(dialog.mode === 'edit' ? dialog.name : '')
  const [category, setCategory] = useState(dialog.mode === 'rename-category' ? dialog.category : initialCategory)
  const [custom, setCustom] = useState('')
  const isCustom = category === NEW_CATEGORY

  const effectiveCategory = isCustom ? custom.trim() : category
  const nameOk = name.trim() !== ''
  const categoryOk = effectiveCategory !== ''
  const valid = nameOk && categoryOk
  const dirty = dialog.mode === 'edit' ? name.trim() !== dialog.name || effectiveCategory !== dialog.category : true

  const title =
    dialog.mode === 'create'
      ? t('新增概念|New concept')
      : dialog.mode === 'edit'
        ? t('编辑概念|Edit concept')
        : t('大类改名|Rename category')

  const submit = (): void => {
    if (dialog.mode === 'create') {
      onCreate(name.trim(), effectiveCategory)
    } else if (dialog.mode === 'edit') {
      onUpdate(dialog.name, name.trim(), effectiveCategory)
    } else {
      onRenameCategory(dialog.category, effectiveCategory)
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
          {dialog.mode !== 'rename-category' && (
            <label className="cpt-field">
              <span className="cpt-field-label">{t('概念名称|Concept name')}</span>
              <input
                className="cpt-input"
                value={name}
                maxLength={30}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && valid && dirty && !busy) {
                    submit()
                  }
                }}
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
              />
            </label>
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
