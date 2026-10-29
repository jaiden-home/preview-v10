'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Treemap from 'treemap-heatmap'
import type { TreemapChart } from 'treemap-heatmap'
import { useLocale } from '@/components/terminal/useLocale'
import type { ConceptHeat, HeatPeriodKey, HeatPeriods } from '@/lib/screener/types'

/* —— 概念热力 treemap：treemap-heatmap 库（npm 依赖 ^1.1.0，客户端组件内静态导入） ——
   口径与 market 项目看板一致：面积 = 涨股比广度（up/evalN × 1000 + 1），颜色 = 周期内平均涨幅
   （满幅按周期固定：日 ±10%、周 ±20%、月 ±30%、年 ±60%）映射库内分叉标度
   （正端红 / 负端绿 / 0% 灰，A 股红涨绿跌）；点击大类放大 / Esc 返回，tooltip 含 Wilson 95% CI；
   放大态点选子概念可多选（跨大类，返回总览/切周期保留）→ chips 联动下方领涨股表。 */

type HeatItem = ConceptHeat & { weight: number }
type HeatGroup = { name: string; weight: number; up: number; evalN: number; avgPct: number; concepts: HeatItem[] }
type HeatData = { categories: HeatGroup[]; colorSpan: number }

/** 颜色满幅（%）：按周期固定——日 ±10%、周 ±20%、月 ±30%、年 ±60%（0% 锚定中性灰） */
const COLOR_SPAN: Record<HeatPeriodKey, number> = { day: 10, week: 20, month: 30, year: 60 }

const PERIOD_VIEWS: Array<{ key: HeatPeriodKey; label: string }> = [
  { key: 'day', label: '日|Day' },
  { key: 'week', label: '周|Week' },
  { key: 'month', label: '月|Month' },
  { key: 'year', label: '年|Year' }
]

const fmtPct = (x: number | null): string => (x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(2)}%`)

export default function ConceptTreemap({
  periods,
  categories,
  selected,
  onToggle
}: {
  periods: HeatPeriods
  categories: string[]
  /** 已选子概念名（放大态点选，多选） */
  selected: string[]
  onToggle: (name: string) => void
}) {
  const { t } = useLocale()
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<TreemapChart | null>(null)
  const colorSpanRef = useRef(10) // 当期颜色满幅（color accessor 建图时闭包一次，经 ref 取当期值）
  const dataRef = useRef<HeatData>({ categories: [], colorSpan: 10 })
  const selRef = useRef<Set<string>>(new Set())
  const [period, setPeriod] = useState<HeatPeriodKey>('day')
  const [zoomGroup, setZoomGroup] = useState<HeatGroup | null>(null)

  /** 热力数据：按大类分组；面积 = 涨股比广度，颜色 = 概念平均涨幅（满幅随周期自适应） */
  const data = useMemo<HeatData>(() => {
    const items: HeatItem[] = (periods[period] ?? [])
      .filter((c) => c.evalN >= 3)
      .map((c) => ({ ...c, weight: (c.up / c.evalN) * 1000 + 1 }))
    const colorSpan = COLOR_SPAN[period]
    const mk = (name: string, list: HeatItem[]): HeatGroup => {
      const evalN = list.reduce((s, c) => s + c.evalN, 0)
      const up = list.reduce((s, c) => s + c.up, 0)
      return {
        name,
        // 大类权重 = 大类自身涨股比 ×1000 + 1（引擎对大类/子概念同一 area 函数；Σ概念权重会随概念数膨胀扭曲落位）
        weight: evalN > 0 ? (up / evalN) * 1000 + 1 : 1,
        up,
        evalN,
        avgPct: evalN > 0 ? list.reduce((s, c) => s + c.avgPct * c.evalN, 0) / evalN : 0,
        concepts: list
      }
    }
    const groups = categories
      .map((cat) =>
        mk(
          cat,
          items.filter((i) => i.category === cat)
        )
      )
      .filter((g) => g.concepts.length > 0)
    const rest = items.filter((i) => !categories.includes(i.category))
    if (rest.length > 0) groups.push(mk(t('其他|Others'), rest))
    return { categories: groups, colorSpan }
  }, [periods, period, categories, t])

  /** 选中标记：按色块 dataset.c/i 反查子概念，同步品牌蓝描边（库重建 DOM 后重打） */
  const applySelMarks = useCallback(() => {
    const host = hostRef.current
    if (host == null) return
    host.querySelectorAll<HTMLElement>('.tm-cell').forEach((el) => {
      const item = dataRef.current.categories[Number(el.dataset.c)]?.concepts[Number(el.dataset.i)]
      el.classList.toggle('screen-heat-cell-sel', item != null && selRef.current.has(item.name))
    })
  }, [])

  useEffect(() => {
    selRef.current = new Set(selected)
    applySelMarks()
  }, [selected, applySelMarks])

  /** 数据更新（含切周期）：squarify 按当前权重重新落位；放大态跟随切换后的同名大类 */
  useEffect(() => {
    const chart = chartRef.current
    dataRef.current = data
    colorSpanRef.current = data.colorSpan
    if (chart == null) return
    chart.data(data).render()
    setZoomGroup(chart.zoomed() ?? null)
  }, [data])

  /** 建图：按库口径接线（面积=涨股比广度，颜色=均值满幅映射） */
  useEffect(() => {
    const host = hostRef.current
    if (host == null) return
    colorSpanRef.current = data.colorSpan
    const chart = Treemap(host, {
      data,
      groups: (d: HeatData) => d.categories,
      items: (g: HeatGroup) => g.concepts,
      area: (d: HeatItem | HeatGroup) => d.weight,
      color: (d: HeatItem | HeatGroup) => {
        const span = colorSpanRef.current
        return Math.min(1, Math.max(0, d.avgPct / span / 2 + 0.5))
      },
      label: (d: HeatItem | HeatGroup) => d.name,
      sublabel: (d: HeatItem | HeatGroup) => fmtPct(d.avgPct),
      detail: (d: HeatItem) => {
        const parts: string[] = []
        if (d.evalN > 0) {
          const ci = Treemap.wilson(d.up, d.evalN)
          parts.push(
            `${t('涨股比|Up ratio')} ${d.up}/${d.evalN}${ci != null ? `（CI ${Math.round(ci.lo * 100)}–${Math.round(ci.hi * 100)}%）` : ''}`
          )
        }
        if (d.leader != null) parts.push(`${t('领涨|Leader')} ${d.leader.name} ${fmtPct(d.leader.pct)}`)
        return parts.length > 0 ? parts.join('<br>') : null
      },
      sortItems: (a: HeatItem, b: HeatItem, group: HeatGroup) =>
        (group.avgPct < 0 ? -1 : 1) * ((b.avgPct || 0) - (a.avgPct || 0)),
      sortGroups: (a: HeatGroup, b: HeatGroup) => (b.avgPct || 0) - (a.avgPct || 0),
      layout: 'squarify',
      tooltip: (item: HeatItem, group: HeatGroup) => {
        let html = `<div class="tm-tt">${item.name}<span class="tm-tc">${group.name}</span></div>`
        html += `<div class="tm-tr"><span>${t('平均涨幅|Avg change')}</span><b>${fmtPct(item.avgPct)}</b></div>`
        if (item.evalN > 0) {
          const ci = Treemap.wilson(item.up, item.evalN)
          html += `<div class="tm-tr"><span>${t('涨股比|Up ratio')}</span><b>${item.up}/${item.evalN}（${Math.round((item.up / item.evalN) * 100)}%）</b></div>`
          if (ci != null) {
            html += `<div class="tm-tr"><span>95% CI</span><b>${Math.round(ci.lo * 100)}% – ${Math.round(ci.hi * 100)}%</b></div>`
          }
        }
        html += `<div class="tm-tr"><span>${t('成分股数|Members')}</span><b>${item.n}</b></div>`
        if (item.leader != null) {
          html += `<div class="tm-tr"><span>${t('领涨股|Leader stock')}</span><b>${item.leader.name} ${fmtPct(item.leader.pct)}</b></div>`
        }
        return html
      }
    })
    chartRef.current = chart
    chart
      .on('zoom', (g: HeatGroup) => setZoomGroup(g ?? null))
      .on('back', () => setZoomGroup(null))
      .render()

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') chart.back()
    }
    document.addEventListener('keydown', onKey)

    // 库每次重渲染（放大/返回/切周期/resize）都重建色块 DOM：观察子树变化后重打选中描边
    const mo = new MutationObserver(applySelMarks)
    mo.observe(host, { childList: true, subtree: true })
    applySelMarks()

    return () => {
      mo.disconnect()
      document.removeEventListener('keydown', onKey)
      chart.destroy()
      chartRef.current = null
      setZoomGroup(null)
    }
    // 刻意不依赖 data：数据/切周期由上方独立效应经 chart.data() 热更，避免整图重建丢放大态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySelMarks, t])

  /** 放大态点击子概念：选中/取消（捕获阶段取当前态——总览态点击交给库放大，不选中） */
  const onHostClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const chart = chartRef.current
    if (chart == null || chart.zoomed() == null) return
    const cell = (e.target as HTMLElement).closest('.tm-cell') as HTMLElement | null
    if (cell == null) return
    const item = dataRef.current.categories[Number(cell.dataset.c)]?.concepts[Number(cell.dataset.i)]
    if (item != null) onToggle(item.name)
  }

  const totalConcepts = data.categories.reduce((s, g) => s + g.concepts.length, 0)
  const span = COLOR_SPAN[period]

  return (
    <div className="screen-heat">
      <div className="screen-heat-head">
        <div className="period-group" role="tablist" aria-label={t('热力图周期|Heatmap period')}>
          {PERIOD_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={period === v.key}
              className={`tb-btn${period === v.key ? ' active' : ''}`}
              onClick={() => setPeriod(v.key)}
            >
              {t(v.label)}
            </button>
          ))}
        </div>
        {/* 数值颜色图例：分叉标度（绿跌—灰平—红涨，满幅随周期），不依赖颜色单独表达 */}
        <div className="screen-heat-legend" aria-hidden="true">
          <span className="num screen-legend-min">-{span}%</span>
          <span className="screen-legend-bar" />
          <span className="num screen-legend-max">+{span}%</span>
        </div>
        <span className="screen-heat-sub">
          {zoomGroup != null
            ? t(
                `${zoomGroup.name}　均值 ${fmtPct(zoomGroup.avgPct)}　涨股比 ${zoomGroup.up}/${zoomGroup.evalN}　（点击子概念选中，可多选）|${zoomGroup.name} · avg ${fmtPct(zoomGroup.avgPct)} · up ${zoomGroup.up}/${zoomGroup.evalN} (click concept to select, multi)`
              )
            : t(
                `全部 ${data.categories.length} 大类 · ${totalConcepts} 子概念（点击大类放大，再点子概念选中；Esc 返回总览）|${data.categories.length} categories · ${totalConcepts} concepts (click to zoom, click concept to select; Esc back)`
              )}
        </span>
        {zoomGroup != null && (
          <button type="button" className="tb-btn" onClick={() => chartRef.current?.back()}>
            {t('返回总览|Back')}
          </button>
        )}
      </div>
      {data.categories.length === 0 ? (
        <div className="screen-heat-empty">
          {t('概念热力暂无数据（需当前周期首末两个交易日的 K 线）|No heatmap data for this period')}
        </div>
      ) : (
        <div
          ref={hostRef}
          className="screen-heat-cloud"
          onClickCapture={onHostClick}
          role="application"
          aria-label={t(
            '概念板块热力图，选中概念可筛选下方领涨股表|Concept sector heatmap, selection filters the table below'
          )}
        />
      )}
    </div>
  )
}
