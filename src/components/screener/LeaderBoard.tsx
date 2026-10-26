'use client'

import { useMemo, useState } from 'react'
import { useLocale } from '@/components/terminal/useLocale'
import type { BoardData } from '@/lib/screener/types'
import ConceptTreemap from './ConceptTreemap'
import LeaderTable from './LeaderTable'

/** 领涨看板：数据总览卡 + 概念热力（选中概念联动筛表）+ 领涨股表（排序/筛选/搜索） */
export default function LeaderBoard({ board }: { board: BoardData }) {
  const { t } = useLocale()
  const [selConcepts, setSelConcepts] = useState<string[]>([])
  const toggleConcept = (name: string): void =>
    setSelConcepts((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]))

  const uniqConcepts = useMemo(() => new Set(board.leaders.flatMap((l) => l.concepts)).size, [board.leaders])
  const totalEvents = useMemo(() => board.leaders.reduce((s, l) => s + l.events, 0), [board.leaders])

  const deck: Array<{ label: string; value: string | number; num?: boolean }> = [
    { label: t('历史领涨股|Leader stocks'), value: board.meta.leaderStocks.toLocaleString() },
    { label: t('趋势达标|Trend qualified'), value: board.leaders.length },
    { label: t('领涨日|Leader days'), value: board.meta.leaderDays.toLocaleString() },
    { label: t('启用股票|Enabled stocks'), value: board.meta.stocks },
    { label: t('覆盖概念|Concepts'), value: board.meta.concepts },
    { label: t('停用（ST/科创）|Disabled'), value: board.meta.filtered }
  ]

  return (
    <>
      <section className="trade-card screen-overview" aria-label={t('数据总览|Overview')}>
        {deck.map((d) => (
          <div key={d.label} className="screen-stat">
            <span className="screen-stat-k">{d.label}</span>
            <span className="screen-stat-v num">{d.value}</span>
          </div>
        ))}
      </section>

      <section className="trade-card" aria-label={t('概念板块热力|Concept heatmap')}>
        <div className="market-card-head">
          <span className="market-card-title">{t('概念板块热力（日 / 周 / 月 / 年）|Concept heatmap (D/W/M/Y)')}</span>
          <span className="market-card-sub num">
            {t(
              `领涨概念 ${uniqConcepts} 个 · 事件 ${totalEvents.toLocaleString()} 条 · 面积 = 涨股比 · 颜色 = 平均涨幅|${uniqConcepts} concepts · ${totalEvents.toLocaleString()} events · area = up-ratio · color = avg change`
            )}
          </span>
        </div>
        <div className="screen-heat-body">
          <ConceptTreemap
            periods={board.periods}
            categories={board.categories}
            selected={selConcepts}
            onToggle={toggleConcept}
          />
          {selConcepts.length > 0 && (
            <div className="screen-chips">
              <span className="screen-chips-label">
                {t(`已选概念 ${selConcepts.length} 个（命中任一即入选）：|Selected ${selConcepts.length} (any hit):`)}
              </span>
              {selConcepts.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="screen-chip"
                  title={t('点击取消选中|Click to deselect')}
                  onClick={() => toggleConcept(name)}
                >
                  {name} ✕
                </button>
              ))}
              <button type="button" className="tb-btn" onClick={() => setSelConcepts([])}>
                {t('清空|Clear')}
              </button>
            </div>
          )}
          <div className="screen-caliber-note">
            {t(
              '热力口径：矩形面积 = 周期内涨股比广度，颜色 = 平均涨幅（满幅随周期：日 ±10% / 周 ±20% / 月 ±30% / 年 ±60%，红涨绿跌）；日 = 昨收基准，周/月/年 = 近 7/30/365 自然日。点击大类放大（Wilson 95% CI），放大态点选子概念可多选，选中集按「命中任一」筛选下方领涨股表。|Area = up-ratio breadth, color = avg change (span ±10/20/30/60% by period, red up green down); day = prev close, W/M/Y = 7/30/365d. Click to zoom (Wilson 95% CI); select concepts in zoom to filter the table (any-hit).'
            )}
          </div>
        </div>
      </section>

      <LeaderTable
        leaders={board.leaders}
        categories={board.categories}
        lastDate={board.meta.lastDate}
        selectedConcepts={selConcepts}
      />
    </>
  )
}
