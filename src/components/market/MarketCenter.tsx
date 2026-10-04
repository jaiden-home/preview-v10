'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useDismiss } from '@/components/terminal/useDismiss'
import { useLocale } from '@/components/terminal/useLocale'
import { fetchMarketOverview, fetchSymbolSearch } from '@/lib/chart/api'
import { POLL_INTERVAL_MS } from '@/lib/chart/constants'
import type {
  MarketBoard,
  MarketBoardSort,
  MarketOverview,
  MarketSortDirection,
  QuoteSnapshot,
  SymbolSearchItem
} from '@/lib/chart/types'
import { loadWatchlist, persistWatchlist, toggleWatchItem, type WatchItem } from '@/lib/watchlist'
import StarButton from './StarButton'

type RankView = 'gainers' | 'losers' | 'turnover'

const VIEW_PARAMS: Record<RankView, { sort: MarketBoardSort; dir: MarketSortDirection }> = {
  gainers: { sort: 'changePct', dir: 'desc' },
  losers: { sort: 'changePct', dir: 'asc' },
  turnover: { sort: 'turnover', dir: 'desc' }
}

const codeOf = (item: { market: string; ticker: string }): string => `${item.market}${item.ticker}`

/** 涨跌方向类：红涨绿跌，平盘/缺失不着色 */
const dirClass = (value: number | null): string => {
  if (value == null || value === 0) {
    return ''
  }
  return value > 0 ? 'up' : 'down'
}

const fmtNum = (value: number | null, digits = 2): string => (value == null ? '--' : value.toFixed(digits))

const fmtPct = (value: number | null): string => (value == null ? '--' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`)

/** 成交额（元）按语种习惯缩写：zh 亿/万，en B/M/K */
const fmtAmount = (value: number | null, en: boolean): string => {
  if (value == null) {
    return '--'
  }
  const abs = Math.abs(value)
  if (en) {
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
    if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`
    return value.toFixed(0)
  }
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(2)}万`
  return value.toFixed(0)
}

/** 指数/个股涨跌派生（现价 + 昨收 → 额与幅） */
const changeOf = (quote: QuoteSnapshot): { change: number | null; changePct: number | null } => {
  if (quote.price == null || quote.prevClose == null || quote.prevClose <= 0) {
    return { change: null, changePct: null }
  }
  const change = quote.price - quote.prevClose
  return { change, changePct: (change / quote.prevClose) * 100 }
}

interface MarketSearchProps {
  t: (text: string) => string
  watchedCodes: Set<string>
  onToggleWatch: (item: { market: string; ticker: string; name: string }) => void
}

/** 标的搜索：复用终端下拉搜索范式，行内星标可加自选、点击行进看板 */
function MarketSearch({ t, watchedCodes, onToggleWatch }: MarketSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{ q: string; items: SymbolSearchItem[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useDismiss(open, () => setOpen(false))

  const q = query.trim()
  const items = q === '' ? [] : search?.q === q ? search.items : []

  useEffect(() => {
    if (q === '') {
      return
    }
    const timer = setTimeout(() => {
      void fetchSymbolSearch(q).then((items) => setSearch({ q, items }))
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  return (
    <div className="toolbar-item market-search" ref={wrapRef}>
      <button className="tb-btn tb-dd" type="button" onClick={() => setOpen((prev) => !prev)}>
        {t('搜索|Search')}
      </button>
      <div className={`dropdown symbol-dropdown${open ? ' open' : ''}`}>
        <div className="search-box">
          <input
            ref={inputRef}
            className="symbol-search-input"
            placeholder={t('搜索代码或名称|Search code or name')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className={`search-clear-btn${query !== '' ? ' visible' : ''}`}
            type="button"
            title={t('清空|Clear')}
            onClick={(event) => {
              event.stopPropagation()
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            ×
          </button>
        </div>
        <div className="symbol-list">
          {q !== '' && items.length === 0 && <div className="symbol-empty">{t('无结果|No results')}</div>}
          {items.map((item) => {
            const code = codeOf(item)
            return (
              <div key={code} className="symbol-row market-search-row">
                <Link className="market-search-info" href={`/dashboard?symbol=${code}`}>
                  <span className="symbol-ticker">{item.ticker}</span>
                  <span className="symbol-name">{item.name}</span>
                </Link>
                <StarButton
                  active={watchedCodes.has(code)}
                  title={watchedCodes.has(code) ? t('移除自选|Remove from watchlist') : t('加入自选|Add to watchlist')}
                  onToggle={() => onToggleWatch(item)}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface MarketCenterProps {
  /** SSR 直供的默认视图（行业涨幅榜）；加载失败为 null，客户端兜底轮询 */
  initial: MarketOverview | null
}

/** 行情中心：指数概览 + 官方板块榜（行业/概念 × 涨幅/跌幅/成交额）+ 自选收藏；行点击深链看板 */
export default function MarketCenter({ initial }: MarketCenterProps) {
  const { locale, t } = useLocale()
  const en = locale === 'en-US'

  const [overview, setOverview] = useState<MarketOverview | null>(initial)
  const [failed, setFailed] = useState(false)
  const [board, setBoard] = useState<MarketBoard>('industry')
  const [view, setView] = useState<RankView>('gainers')
  const [watchlist, setWatchlist] = useState<WatchItem[]>([])
  const [retryTick, setRetryTick] = useState(0)

  const overviewRef = useRef<MarketOverview | null>(initial)
  useEffect(() => {
    overviewRef.current = overview
  }, [overview])

  // 自选自 localStorage 载入（SSR 首帧为空，挂载后回填）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWatchlist(loadWatchlist())
  }, [])

  const watchKey = useMemo(() => watchlist.map(codeOf).join(','), [watchlist])
  const watchedCodes = useMemo(() => new Set(watchKey.split(',').filter(Boolean)), [watchKey])

  // 总览轮询：榜单视图或自选变化即重拉，此后 3s 一轮（与终端行情同节奏）
  useEffect(() => {
    let cancelled = false
    const params = {
      board,
      ...VIEW_PARAMS[view],
      symbols: watchKey === '' ? [] : watchKey.split(',')
    }
    const tick = async () => {
      const next = await fetchMarketOverview(params)
      if (cancelled) {
        return
      }
      if (next != null) {
        setOverview(next)
        setFailed(false)
      } else if (overviewRef.current == null) {
        setFailed(true)
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [board, view, watchKey, retryTick])

  const toggleWatch = (item: { market: string; ticker: string; name: string }) => {
    setWatchlist((prev) => {
      const next = toggleWatchItem(prev, item)
      persistWatchlist(next)
      return next
    })
  }

  const toggleTheme = () => {
    const root = document.getElementById('app')
    const next = !root?.classList.contains('dark')
    root?.classList.add('theme-switching')
    root?.classList.toggle('dark', next)
    window.setTimeout(() => root?.classList.remove('theme-switching'), 50)
  }

  const ranking = overview?.ranking ?? []
  const indices = overview?.indices ?? []
  const watchQuotes = useMemo(() => {
    const map = new Map<string, QuoteSnapshot>()
    for (const quote of overview?.watches ?? []) {
      map.set(`${quote.market}${quote.ticker}`, quote)
    }
    return map
  }, [overview])

  const emptyIcon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )

  return (
    <div className="market-page">
      <div className="market-scroll">
        <div className="toolbar market-toolbar">
          <div className="toolbar-item">
            <span className="home-brand">{t('行情中心|Market Center')}</span>
          </div>
          <MarketSearch t={t} watchedCodes={watchedCodes} onToggleWatch={toggleWatch} />
          <ThemeToggle t={t} onToggle={toggleTheme} />
        </div>

        {overview == null ? (
          <div className="trade-loading">
            {failed ? (
              <>
                <span>{t('行情加载失败|Failed to load market data')}</span>
                <button className="tb-btn" type="button" onClick={() => setRetryTick((tick) => tick + 1)}>
                  {t('重试|Retry')}
                </button>
              </>
            ) : (
              <span>{t('行情加载中|Loading market data')}</span>
            )}
          </div>
        ) : (
          <div className="market-main">
            <section className="market-indices trade-card" aria-label={t('指数概览|Index overview')}>
              {indices.map((quote) => {
                const { change, changePct } = changeOf(quote)
                const cls = dirClass(change)
                return (
                  <div className="market-index" key={`${quote.market}${quote.ticker}`}>
                    <span className="market-index-name">{quote.name ?? `${quote.market}${quote.ticker}`}</span>
                    <span className={`market-index-price num ${cls}`}>{fmtNum(quote.price)}</span>
                    <span className={`market-index-change num ${cls}`}>
                      {change == null ? '--' : `${change > 0 ? '+' : ''}${fmtNum(change)}`} {fmtPct(changePct)}
                    </span>
                  </div>
                )
              })}
            </section>

            <div className="market-body">
              <section className="market-rank trade-card" aria-label={t('板块榜单|Board rankings')}>
                <div className="market-rank-head">
                  <div className="period-group" role="tablist" aria-label={t('板块维度|Board type')}>
                    <button
                      className={`tb-btn${board === 'industry' ? ' active' : ''}`}
                      type="button"
                      role="tab"
                      aria-selected={board === 'industry'}
                      onClick={() => setBoard('industry')}
                    >
                      {t('行业|Industry')}
                    </button>
                    <button
                      className={`tb-btn${board === 'concept' ? ' active' : ''}`}
                      type="button"
                      role="tab"
                      aria-selected={board === 'concept'}
                      onClick={() => setBoard('concept')}
                    >
                      {t('概念|Concept')}
                    </button>
                  </div>
                  <div className="period-group" role="tablist" aria-label={t('榜单排序|Ranking sort')}>
                    <button
                      className={`tb-btn${view === 'gainers' ? ' active' : ''}`}
                      type="button"
                      role="tab"
                      aria-selected={view === 'gainers'}
                      onClick={() => setView('gainers')}
                    >
                      {t('涨幅榜|Top gainers')}
                    </button>
                    <button
                      className={`tb-btn${view === 'losers' ? ' active' : ''}`}
                      type="button"
                      role="tab"
                      aria-selected={view === 'losers'}
                      onClick={() => setView('losers')}
                    >
                      {t('跌幅榜|Top losers')}
                    </button>
                    <button
                      className={`tb-btn${view === 'turnover' ? ' active' : ''}`}
                      type="button"
                      role="tab"
                      aria-selected={view === 'turnover'}
                      onClick={() => setView('turnover')}
                    >
                      {t('成交额|By amount')}
                    </button>
                  </div>
                </div>
                {ranking.length === 0 ? (
                  <div className="trade-empty">
                    {emptyIcon}
                    <span className="trade-empty-title">{t('榜单暂不可用|Rankings unavailable')}</span>
                    <span className="trade-empty-sub">
                      {t('上游数据源无响应，稍后自动重试|Upstream not responding, will retry automatically')}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="trade-table-wrap market-rank-wrap">
                      <table className="trade-table">
                        <thead>
                          <tr>
                            <th className="num">#</th>
                            <th className="txt-left">{t('板块|Board')}</th>
                            <th className="num">{t('涨跌幅|Change %')}</th>
                            <th className="num">{t('成交额|Amount')}</th>
                            <th className="num">{t('换手率|Turnover rate')}</th>
                            <th className="txt-left">{t('领涨股|Top stock')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ranking.map((item, index) => (
                            <tr key={item.code}>
                              <td className="num market-rank-no">{index + 1}</td>
                              <td className="txt-left">
                                <span className="market-board-name">{item.name}</span>
                              </td>
                              <td className={`num ${dirClass(item.changePct)}`}>{fmtPct(item.changePct)}</td>
                              <td className="num">{fmtAmount(item.turnover, en)}</td>
                              <td className="num">{fmtNum(item.turnoverRate)}%</td>
                              <td className="txt-left">
                                {item.leading != null ? (
                                  <span className="market-leading">
                                    <StarButton
                                      active={watchedCodes.has(codeOf(item.leading))}
                                      title={
                                        watchedCodes.has(codeOf(item.leading))
                                          ? t('移除自选|Remove from watchlist')
                                          : t('加入自选|Add to watchlist')
                                      }
                                      onToggle={() => toggleWatch(item.leading!)}
                                    />
                                    <Link
                                      className="market-leading-link"
                                      href={`/dashboard?symbol=${codeOf(item.leading)}`}
                                    >
                                      {item.leading.name}
                                    </Link>
                                    <span className={`market-leading-pct num ${dirClass(item.leading.changePct)}`}>
                                      {fmtPct(item.leading.changePct)}
                                    </span>
                                  </span>
                                ) : (
                                  '--'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="market-list">
                      {ranking.map((item, index) => (
                        <div className="market-item" key={item.code}>
                          <div className="market-item-head">
                            <span className="market-item-rank num">{index + 1}</span>
                            <span className="market-item-name">{item.name}</span>
                            <span className={`market-item-pct num ${dirClass(item.changePct)}`}>
                              {fmtPct(item.changePct)}
                            </span>
                          </div>
                          <div className="market-item-stats">
                            {item.leading != null ? (
                              <span className="market-item-leading">
                                <StarButton
                                  active={watchedCodes.has(codeOf(item.leading))}
                                  title={
                                    watchedCodes.has(codeOf(item.leading))
                                      ? t('移除自选|Remove from watchlist')
                                      : t('加入自选|Add to watchlist')
                                  }
                                  onToggle={() => toggleWatch(item.leading!)}
                                />
                                <Link
                                  className="market-leading-link"
                                  href={`/dashboard?symbol=${codeOf(item.leading)}`}
                                >
                                  {item.leading.name}
                                </Link>
                                <span className={`market-leading-pct num ${dirClass(item.leading.changePct)}`}>
                                  {fmtPct(item.leading.changePct)}
                                </span>
                              </span>
                            ) : null}
                            <span className="market-item-stat">
                              {t('成交|Amt')} <b className="num">{fmtAmount(item.turnover, en)}</b>
                            </span>
                            <span className="market-item-stat">
                              {t('换手|T/O')} <b className="num">{fmtNum(item.turnoverRate)}%</b>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section className="market-watch trade-card" aria-label={t('自选|Watchlist')}>
                <div className="market-card-head">
                  <span className="market-card-title">{t('自选|Watchlist')}</span>
                  <span className="market-card-sub">{t('点击标的进入看板|Click a symbol to open dashboard')}</span>
                </div>
                {watchlist.length === 0 ? (
                  <div className="trade-empty">
                    {emptyIcon}
                    <span className="trade-empty-title">{t('暂无自选|No watchlist yet')}</span>
                    <span className="trade-empty-sub">
                      {t('在搜索或榜单领涨股中点星标收藏|Star stocks from search or board rankings')}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="trade-table-wrap">
                      <table className="trade-table">
                        <thead>
                          <tr>
                            <th className="txt-left">{t('标的|Symbol')}</th>
                            <th className="num">{t('现价|Price')}</th>
                            <th className="num">{t('涨跌|Change')}</th>
                            <th className="num">{t('涨跌幅|Change %')}</th>
                            <th className="num">{t('自选|Watch')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {watchlist.map((watch) => {
                            const quote = watchQuotes.get(codeOf(watch))
                            const { change, changePct } =
                              quote != null ? changeOf(quote) : { change: null, changePct: null }
                            const cls = dirClass(change)
                            return (
                              <tr key={codeOf(watch)}>
                                <td className="txt-left">
                                  <Link className="cell-symbol" href={`/dashboard?symbol=${codeOf(watch)}`}>
                                    <span className="cell-name">{quote?.name ?? watch.name}</span>
                                    <span className="cell-code">{codeOf(watch)}</span>
                                  </Link>
                                </td>
                                <td className={`num ${cls}`}>{fmtNum(quote?.price ?? null)}</td>
                                <td className={`num ${cls}`}>
                                  {change == null ? '--' : `${change > 0 ? '+' : ''}${fmtNum(change)}`}
                                </td>
                                <td className={`num ${cls}`}>{fmtPct(changePct)}</td>
                                <td className="num">
                                  <StarButton
                                    active
                                    title={t('移除自选|Remove from watchlist')}
                                    onToggle={() => toggleWatch(watch)}
                                  />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="market-list">
                      {watchlist.map((watch) => {
                        const quote = watchQuotes.get(codeOf(watch))
                        const { change, changePct } =
                          quote != null ? changeOf(quote) : { change: null, changePct: null }
                        const cls = dirClass(change)
                        return (
                          <div className="market-item market-watch-item" key={codeOf(watch)}>
                            <Link className="market-watch-link" href={`/dashboard?symbol=${codeOf(watch)}`}>
                              <span className="market-watch-id">
                                <span className="cell-name">{quote?.name ?? watch.name}</span>
                                <span className="cell-code">{codeOf(watch)}</span>
                              </span>
                              <span className="market-watch-quote">
                                <span className={`num ${cls}`}>{fmtNum(quote?.price ?? null)}</span>
                                <span className={`num ${cls}`}>{fmtPct(changePct)}</span>
                              </span>
                            </Link>
                            <StarButton
                              active
                              title={t('移除自选|Remove from watchlist')}
                              onToggle={() => toggleWatch(watch)}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
