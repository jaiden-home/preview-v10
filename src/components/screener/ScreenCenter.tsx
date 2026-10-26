'use client'

import { useCallback, useState } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useLocale } from '@/components/terminal/useLocale'
import { fetchBoardRequest } from '@/lib/chart/api'
import type { BoardData } from '@/lib/screener/types'
import LeaderBoard from './LeaderBoard'
import Screener from './Screener'

/** 选股中心：领涨看板（本地快照库）与条件选股（条件组合器）双模式 Tab 壳 */

type TabKey = 'board' | 'cond'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'board', label: '领涨看板|Leader board' },
  { key: 'cond', label: '条件选股|Condition screen' }
]

export default function ScreenCenter({ initialBoard }: { initialBoard: BoardData | null }) {
  const { t } = useLocale()
  const [tab, setTab] = useState<TabKey>('board')
  const [board, setBoard] = useState<BoardData | null>(initialBoard)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (refreshing) {
      return
    }
    setRefreshing(true)
    setError(null)
    const result = await fetchBoardRequest(true)
    if (result.ok) {
      setBoard(result.board)
    } else {
      setError(t(result.message))
    }
    setRefreshing(false)
  }, [refreshing, t])

  const toggleTheme = (): void => {
    const root = document.getElementById('app')
    const next = !(root?.classList.contains('dark') ?? false)
    root?.classList.add('theme-switching')
    root?.classList.toggle('dark', next)
    window.setTimeout(() => root?.classList.remove('theme-switching'), 50)
  }

  return (
    <div className="screener-page">
      <div className="screener-scroll">
        <div className="toolbar screener-toolbar">
          <div className="toolbar-item">
            <span className="home-brand">{t('选股中心|Screener Center')}</span>
          </div>
          <ThemeToggle t={t} onToggle={toggleTheme} />
        </div>

        <div className={`screener-main${tab === 'board' ? ' screener-main-wide' : ''}`}>
          <div className="screen-tabs-row">
            <div className="period-group screen-tabs" role="tablist" aria-label={t('选股模式|Screener mode')}>
              {TABS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === v.key}
                  className={`tb-btn${tab === v.key ? ' active' : ''}`}
                  onClick={() => setTab(v.key)}
                >
                  {t(v.label)}
                </button>
              ))}
            </div>
            {tab === 'board' && (
              <div className="screen-meta">
                {board != null ? (
                  <span className="screen-date-badge num" title={t('本地快照库数据截至日期|Local snapshot data as of')}>
                    {t(`数据截至|As of`)} {board.meta.lastDate}
                  </span>
                ) : null}
                <button type="button" className="tb-btn" disabled={refreshing} onClick={() => void refresh()}>
                  {refreshing ? t('刷新中…|Refreshing…') : t('刷新|Refresh')}
                </button>
              </div>
            )}
          </div>

          {tab === 'board' ? (
            board != null ? (
              <LeaderBoard board={board} />
            ) : (
              <section className="trade-card">
                <div className="trade-empty">
                  <span className="trade-empty-title">{t('看板数据尚未就绪|Board data not ready')}</span>
                  <span className="trade-empty-sub">
                    {refreshing
                      ? t('首次计算全量指标，约需数秒~半分钟|Computing full metrics, may take a while')
                      : error != null
                        ? error
                        : t('将 market.db 复制到 dbdata/ 后点「刷新」|Copy market.db into dbdata/ then hit Refresh')}
                  </span>
                  {!refreshing && (
                    <button type="button" className="tb-btn" onClick={() => void refresh()}>
                      {t('重试|Retry')}
                    </button>
                  )}
                </div>
              </section>
            )
          ) : (
            <Screener />
          )}
        </div>
      </div>
    </div>
  )
}
