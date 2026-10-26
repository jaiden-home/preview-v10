'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import StarButton from '@/components/market/StarButton'
import { useLocale } from '@/components/terminal/useLocale'
import type { LeaderRow } from '@/lib/screener/types'
import { loadWatchlist, persistWatchlist, toggleWatchItem, type WatchItem } from '@/lib/watchlist'

/** 领涨股表：排序/筛选/搜索全在客户端（服务端一次给全量趋势达标股）；
    热力图已选概念由父组件传入（命中任一 OR 过滤）。 */

type SortKey =
  | 'days'
  | 'days365'
  | 'lastBuy'
  | 'streak'
  | 'highStreak'
  | 'buyStreak'
  | 'pct'
  | 'maRatio'
  | 'trendDays'
  | 'join'
  | 'price'
  | 'highHalf'
  | 'highYear'
  | 'limitUp365'

const fmtPct = (x: number | null): string => (x == null ? '--' : `${x > 0 ? '+' : ''}${x.toFixed(2)}%`)
const fmtPrice = (v: number | null): string => (v == null ? '--' : v.toFixed(2))
const dirClass = (v: number | null): string => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down')

/** 档位筛选定义：label 双语 + 选项（value=all 不限） */
interface FieldFilter {
  key: string
  label: string
  hint?: string
  options: Array<{ value: string; label: string }>
}

export default function LeaderTable({
  leaders,
  categories,
  lastDate,
  selectedConcepts
}: {
  leaders: LeaderRow[]
  categories: string[]
  lastDate: string
  /** 热力图已选子概念（多选，命中任一 OR 过滤） */
  selectedConcepts: string[]
}) {
  const { t } = useLocale()
  const [q, setQ] = useState('')
  const [fCategory, setFCategory] = useState('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'desc' | 'asc' } | null>(null)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [watchlist, setWatchlist] = useState<WatchItem[]>([])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWatchlist(loadWatchlist())
  }, [])

  const watchedCodes = useMemo(() => new Set(watchlist.map((w) => `${w.market}${w.ticker}`)), [watchlist])

  const toggleWatch = (row: LeaderRow): void => {
    const market = row.exchange === 'SH' ? 'sh' : 'sz'
    setWatchlist((prev) => {
      const next = toggleWatchItem(prev, { market, ticker: row.code, name: row.name })
      persistWatchlist(next)
      return next
    })
  }

  /** 字段筛选定义（下拉档位；null 字段不满足任何正阈值档） */
  const fieldFilters: FieldFilter[] = useMemo(
    () => [
      {
        key: 'days',
        label: '领涨天数|Lead days',
        hint: t('全部历史发生领涨的交易日数（同日多概念不重复计）|Total distinct leader days in history'),
        options: [
          { value: '10', label: '≥ 10' },
          { value: '30', label: '≥ 30' },
          { value: '100', label: '≥ 100' },
          { value: '300', label: '≥ 300' }
        ]
      },
      {
        key: 'days365',
        label: '一年领涨|1Y lead',
        hint: t('近 365 自然日内发生领涨的交易日数|Leader days within last 365 days'),
        options: [
          { value: '1', label: '≥ 1' },
          { value: '3', label: '≥ 3' },
          { value: '5', label: '≥ 5' },
          { value: '10', label: '≥ 10' }
        ]
      },
      {
        key: 'streak',
        label: '连涨|Up days',
        hint: t('最新交易日为终点的连续收盘上涨天数|Consecutive up closes ending at latest day'),
        options: ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((v) => ({ value: v, label: `≥ ${v}` }))
      },
      {
        key: 'highStreak',
        label: '连高|Higher days',
        hint: t('最新交易日为终点的连续最高价抬高天数|Consecutive higher highs ending at latest day'),
        options: [
          { value: '1', label: '≥ 1' },
          { value: '2', label: '≥ 2' },
          { value: '3', label: '≥ 3' },
          { value: '5', label: '≥ 5' }
        ]
      },
      {
        key: 'buyStreak',
        label: 'B点连涨|B streak',
        hint: t('最近 B 日之后连续上涨天数（断链冻结）|Up days after the latest B point (frozen once broken)'),
        options: [
          { value: '1', label: '≥ 1' },
          { value: '2', label: '≥ 2' },
          { value: '3', label: '≥ 3' }
        ]
      },
      {
        key: 'ma',
        label: '均线比|MA ratio',
        hint: t('MA30 ÷ MA60；> 1 多头，< 1 空头|MA30 ÷ MA60; > 1 bullish, < 1 bearish'),
        options: [
          { value: '1', label: t('≥ 1 多头|≥ 1 bullish') },
          { value: '1.05', label: '≥ 1.05' },
          { value: 'lt1', label: t('< 1 空头|< 1 bearish') }
        ]
      },
      {
        key: 'buy',
        label: '买入点|Last B',
        hint: t('最近 B 点距今的自然日数|Natural days since the latest B point'),
        options: [
          { value: '5', label: t('近 5 日|≤ 5d') },
          { value: '10', label: t('近 10 日|≤ 10d') },
          { value: '20', label: t('近 20 日|≤ 20d') },
          { value: 'none', label: t('近一年无 B|No B in 1Y') }
        ]
      },
      {
        key: 'join',
        label: '本月进入|Joined',
        hint: t('new = 上月末不在名单、本月首次进入|new = first entered this month'),
        options: [
          { value: 'new', label: t('仅新进|New only') },
          { value: 'old', label: t('非新进|Not new') }
        ]
      },
      {
        key: 'flip',
        label: '趋势向上|Trend up',
        hint: t('MA30>MA60 与 收盘>MA60 均持续超 15 个交易日|MA30>MA60 and close>MA60 both for 15+ days'),
        options: [{ value: 'yes', label: t('符合|Yes') }]
      },
      {
        key: 'limitUp',
        label: '一年涨停|1Y limits',
        hint: t('近 365 自然日涨停交易日数（主板 10% / 创业板 20%，容差 0.05）|Limit-up days within 365d'),
        options: [
          { value: '1', label: '≥ 1' },
          { value: '5', label: '≥ 5' },
          { value: '10', label: '≥ 10' }
        ]
      },
      {
        key: 'trendDays',
        label: '趋势天数|Trend days',
        hint: t('近 1 年内 MA30>MA60 连续成立的最长交易日数|Longest MA30>MA60 run within 1Y'),
        options: ['30', '45', '60', '75', '100', '120'].map((v) => ({ value: v, label: `≥ ${v}` }))
      }
    ],
    [t]
  )

  const selSet = useMemo(() => new Set(selectedConcepts), [selectedConcepts])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const ge = (v: number | null, key: string): boolean =>
      filters[key] == null || filters[key] === 'all' || (v != null && v >= Number(filters[key]))
    const daysFrom = (d: string | null): number =>
      d == null ? Number.POSITIVE_INFINITY : Math.round((Date.parse(lastDate) - Date.parse(d)) / 86_400_000)
    const f = filters
    const r = leaders.filter(
      (l) =>
        (kw === '' ||
          l.code.includes(kw) ||
          l.name.toLowerCase().includes(kw) ||
          l.concepts.some((c) => c.toLowerCase().includes(kw))) &&
        (fCategory === 'all' || l.category === fCategory) &&
        (selSet.size === 0 || l.concepts.some((c) => selSet.has(c))) &&
        ge(l.days, 'days') &&
        ge(l.days365, 'days365') &&
        ge(l.streak, 'streak') &&
        ge(l.highStreak, 'highStreak') &&
        ge(l.buyStreak, 'buyStreak') &&
        (f.ma == null ||
          f.ma === 'all' ||
          (f.ma === 'lt1' ? l.maRatio != null && l.maRatio < 1 : l.maRatio != null && l.maRatio >= Number(f.ma))) &&
        (f.buy == null ||
          f.buy === 'all' ||
          (f.buy === 'none' ? l.lastBuy == null : l.lastBuy != null && daysFrom(l.lastBuy) <= Number(f.buy))) &&
        (f.join == null || f.join === 'all' || (f.join === 'new' ? l.isNew : !l.isNew)) &&
        (f.flip == null || f.flip === 'all' || l.fastFlip) &&
        ge(l.limitUp365, 'limitUp') &&
        ge(l.trendDays, 'trendDays')
    )
    if (sort == null) {
      return r.slice().sort((a, b) => b.days - a.days || b.lastDate.localeCompare(a.lastDate))
    }
    const val = (l: LeaderRow): number | string =>
      sort.key === 'lastBuy'
        ? (l.lastBuy ?? '')
        : sort.key === 'buyStreak'
          ? (l.buyStreak ?? -1)
          : sort.key === 'pct'
            ? (l.pct ?? Number.NEGATIVE_INFINITY)
            : sort.key === 'maRatio'
              ? (l.maRatio ?? Number.NEGATIVE_INFINITY)
              : sort.key === 'trendDays'
                ? l.trendDays
                : sort.key === 'days365'
                  ? l.days365
                  : sort.key === 'join'
                    ? (l.joinDate ?? '')
                    : sort.key === 'price'
                      ? (l.price ?? Number.NEGATIVE_INFINITY)
                      : sort.key === 'highStreak'
                        ? l.highStreak
                        : sort.key === 'highHalf'
                          ? (l.highHalf ?? Number.NEGATIVE_INFINITY)
                          : sort.key === 'highYear'
                            ? (l.highYear ?? Number.NEGATIVE_INFINITY)
                            : sort.key === 'limitUp365'
                              ? l.limitUp365
                              : l.days
    const sign = sort.dir === 'desc' ? -1 : 1
    return r.slice().sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      return sign * (va < vb ? -1 : va > vb ? 1 : 0)
    })
  }, [leaders, q, fCategory, selSet, sort, filters, lastDate])

  const toggleSort = (key: SortKey): void =>
    setSort((prev) =>
      prev != null && prev.key === key ? (prev.dir === 'desc' ? { key, dir: 'asc' } : null) : { key, dir: 'desc' }
    )

  const thSort = (key: SortKey, title: string, hint?: string) => (
    <th
      className="screen-sortable"
      scope="col"
      aria-sort={sort != null && sort.key === key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
      title={
        hint != null
          ? `${hint} · ${t('点击排序：降 → 升 → 默认|Click to sort: desc → asc → default')}`
          : t('点击排序：降 → 升 → 默认|Click to sort: desc → asc → default')
      }
      tabIndex={0}
      onClick={() => toggleSort(key)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          toggleSort(key)
        }
      }}
    >
      {t(title)}
      {sort != null && sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  )

  const hasActiveFilters = fCategory !== 'all' || Object.values(filters).some((v) => v != null && v !== 'all')

  return (
    <div className="screen-leaders">
      <div className="market-card-head screen-leaders-head">
        <span className="market-card-title">
          {t('历史领涨股|Leader stocks')}
          <span className="screen-hit-count num">{`${filtered.length} / ${leaders.length}`}</span>
          {sort != null && <span className="market-card-sub num">{t(`已排序|Sorted`)}</span>}
        </span>
        <span className="market-card-sub">
          {t(
            '已过趋势滤（≥60 根日K · 上市满一年 · 3 周强涨链 · 均线规则）· 点击表头排序 · 点击行内标的进看板|Trend-filtered (60+ bars, listed 1Y+, 3-week run, MA rule) · click header to sort'
          )}
        </span>
      </div>
      <div className="screen-filters">
        <input
          type="search"
          className="screen-search"
          placeholder={t('搜索代码 / 名称 / 领涨概念|Search code / name / concept')}
          value={q}
          aria-label={t('搜索领涨股|Search leaders')}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="screen-filter">
          <span>{t('大板块|Sector')}</span>
          <select className="tb-select" value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
            <option value="all">{t('不限|All')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {fieldFilters.map((f) => (
          <label key={f.key} className="screen-filter" title={f.hint}>
            <span>{t(f.label)}</span>
            <select
              className="tb-select"
              value={filters[f.key] ?? 'all'}
              onChange={(e) => setFilters((prev) => ({ ...prev, [f.key]: e.target.value }))}
            >
              <option value="all">{t('不限|All')}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </label>
        ))}
        {hasActiveFilters && (
          <button
            type="button"
            className="tb-btn"
            onClick={() => {
              setFilters({})
              setFCategory('all')
            }}
          >
            {t('清除筛选|Clear')}
          </button>
        )}
      </div>

      {leaders.length === 0 ? (
        <div className="trade-empty">
          <span className="trade-empty-title">{t('暂无趋势达标领涨股|No trend-qualified leaders')}</span>
          <span className="trade-empty-sub">
            {t(
              '库内 leader_events 为空或 K 线未覆盖，检查 market.db 数据|leader_events empty or klines missing in market.db'
            )}
          </span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="trade-empty">
          <span className="trade-empty-title">{t('当前筛选条件下无记录|No records match')}</span>
          <span className="trade-empty-sub">{t('试试放宽字段筛选或更换搜索词|Relax filters or change keyword')}</span>
        </div>
      ) : (
        <>
          <div className="trade-table-wrap screen-leaders-wrap">
            <table className="trade-table">
              <thead>
                <tr>
                  <th className="txt-left">{t('代码|Code')}</th>
                  <th className="txt-left">{t('名称|Name')}</th>
                  <th className="txt-left">{t('概念板块|Concepts')}</th>
                  {thSort('pct', '涨幅|Chg%', t('最新交易日涨跌幅（收盘 ÷ 昨收 − 1）|Latest day change'))}
                  {thSort('price', '价格|Price', t('最新交易日收盘价|Latest close'))}
                  {thSort('highHalf', '半年最高|6M High', t('近 182 自然日最高价|Highest in 182 days'))}
                  {thSort('highYear', '一年最高|1Y High', t('近 365 自然日最高价|Highest in 365 days'))}
                  {thSort('limitUp365', '一年涨停|1Y Limits', t('近 365 自然日涨停交易日数|Limit-up days in 365d'))}
                  {thSort('days', '领涨天数|Lead Days', t('全部历史发生领涨的交易日数|Total leader days'))}
                  {thSort('days365', '一年领涨|1Y Lead', t('近 365 自然日领涨天数|Leader days in 365d'))}
                  {thSort('streak', '连涨|Up Days', t('连续收盘上涨天数|Consecutive up closes'))}
                  {thSort('highStreak', '连高|Higher Days', t('连续最高价抬高天数|Consecutive higher highs'))}
                  {thSort('lastBuy', '最近买入点|Last B', t('近 1 年内最后一个 B 日|Latest B point in 1Y'))}
                  {thSort('buyStreak', 'B点连涨|B Streak', t('最近 B 日后连续上涨天数|Up days after last B'))}
                  {thSort('maRatio', '均线比|MA Ratio', t('MA30 ÷ MA60；> 1 多头，< 1 空头|MA30 ÷ MA60'))}
                  {thSort(
                    'trendDays',
                    '趋势天数|Trend Days',
                    t('近 1 年内 MA30>MA60 最长连续天数|Longest MA30>MA60 run in 1Y')
                  )}
                  {thSort(
                    'join',
                    '本月进入|Joined',
                    t('new = 本月首次进入；有日期 = 掉出又回来|new = first entry this month')
                  )}
                  <th className="num">{t('自选|Star')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  const code = `${l.exchange === 'SH' ? 'sh' : 'sz'}${l.code}`
                  // 收盘即半年最高 或 半年高点越过一年高点 → 价格红色高亮
                  const atHigh =
                    l.price != null &&
                    l.highHalf != null &&
                    l.highYear != null &&
                    (l.price >= l.highHalf || l.highHalf > l.highYear)
                  return (
                    <tr
                      key={code}
                      title={t(
                        `历史领涨概念 ${l.concepts.length} 个 · 事件 ${l.events} 条 · 最近领涨 ${l.lastDate}|${l.concepts.length} concepts · ${l.events} events · last ${l.lastDate}`
                      )}
                    >
                      <td className="txt-left num">{l.code}</td>
                      <td className="txt-left">
                        <Link className="cell-symbol" href={`/dashboard?symbol=${code}`}>
                          <span className="cell-name">{l.name}</span>
                          <span className="cell-code">{code}</span>
                        </Link>
                      </td>
                      <td className="txt-left screen-concepts" title={l.concepts.join('、')}>
                        {l.concepts.length > 3
                          ? `${l.concepts.slice(0, 3).join('、')} ${t(`等${l.concepts.length}个|+${l.concepts.length}`)}`
                          : l.concepts.join('、') || '--'}
                      </td>
                      <td className={`num ${dirClass(l.pct)}`}>{fmtPct(l.pct)}</td>
                      <td className={`num ${atHigh ? 'up' : ''}`}>{fmtPrice(l.price)}</td>
                      <td className={`num ${atHigh ? 'up' : ''}`}>{fmtPrice(l.highHalf)}</td>
                      <td className="num">{fmtPrice(l.highYear)}</td>
                      <td className="num">{l.limitUp365}</td>
                      <td className="num">{l.days}</td>
                      <td className="num">{l.days365}</td>
                      <td className="num">{l.streak}</td>
                      <td className="num">{l.highStreak}</td>
                      <td className="num">{l.lastBuy ?? '--'}</td>
                      <td className="num">{l.buyStreak ?? '--'}</td>
                      <td className={`num ${dirClass(l.maRatio == null ? null : l.maRatio - 1)}`}>
                        {l.maRatio == null ? '--' : l.maRatio.toFixed(3)}
                      </td>
                      <td className="num">{l.trendDays}</td>
                      <td className="num">
                        {l.joinDate != null ? (
                          <>
                            {l.joinDate.slice(5)}
                            {l.isNew && (
                              <span
                                className="screen-new-dot"
                                title={t(
                                  `本月新进（${l.joinDate.slice(5)} 首次进入）|New this month (${l.joinDate.slice(5)})`
                                )}
                                aria-label={t('本月新进|New this month')}
                              />
                            )}
                          </>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="num">
                        <StarButton
                          active={watchedCodes.has(code)}
                          title={
                            watchedCodes.has(code)
                              ? t('移除自选|Remove from watchlist')
                              : t('加入自选|Add to watchlist')
                          }
                          onToggle={() => toggleWatch(l)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="market-list screen-leader-list">
            {filtered.map((l) => {
              const code = `${l.exchange === 'SH' ? 'sh' : 'sz'}${l.code}`
              return (
                <div className="market-item market-watch-item" key={code}>
                  <Link className="market-watch-link" href={`/dashboard?symbol=${code}`}>
                    <span className="market-watch-id">
                      <span className="cell-name">{l.name}</span>
                      <span className="cell-code">
                        {code} · {t(`领涨${l.days}天|led ${l.days}d`)}
                        {l.isNew ? t(' · 新进| new') : ''}
                      </span>
                    </span>
                    <span className="market-watch-quote">
                      <span className={dirClass(l.pct)}>{fmtPrice(l.price)}</span>
                      <span className={dirClass(l.pct)}>{fmtPct(l.pct)}</span>
                    </span>
                  </Link>
                  <StarButton
                    active={watchedCodes.has(code)}
                    title={
                      watchedCodes.has(code) ? t('移除自选|Remove from watchlist') : t('加入自选|Add to watchlist')
                    }
                    onToggle={() => toggleWatch(l)}
                  />
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="screen-caliber">
        <div>
          <div className="screen-caliber-title">{t('领涨股判定|Leader rule')}</div>
          <ul>
            <li>
              {t('板块上涨：概念内涨家比 > 50% 且等权均值 > 3%|Sector up: up-ratio > 50% and equal-weight avg > 3%')}
            </li>
            <li>
              {t(
                '板块上涨时涨停（主板 10% / 创业板 20%）或沪深市场涨幅第一|Limit-up (10%/20%) or top gainer of SH/SZ when sector up'
              )}
            </li>
            <li>{t('成分 < 5 只时仅涨停算|Only limit-up counts when members < 5')}</li>
          </ul>
        </div>
        <div>
          <div className="screen-caliber-title">{t('趋势达标|Trend filter')}</div>
          <ul>
            <li>{t('≥ 60 根日K 且上市满一年（剔次新）|60+ daily bars and listed 1Y+ (no new listings)')}</li>
            <li>{t('当前在市交易 + 周线 3 周强涨链|Currently trading + 3-week strong run')}</li>
            <li>{t('收盘站上 MA30/MA60 中较低者|Close above min(MA30, MA60)')}</li>
          </ul>
        </div>
        <div>
          <div className="screen-caliber-title">{t('B 点买入|B point')}</div>
          <ul>
            <li>
              {t('连涨链恰第 3 日（high 容差 0.999）且收盘 ≥ MA30|Day-3 of up chain (0.999 tol) and close ≥ MA30')}
            </li>
            <li>{t('动能双下限：R2+R3 ≥ R1×0.5 且 R3 ≥ R2×0.15|Momentum: R2+R3 ≥ R1×0.5 and R3 ≥ R2×0.15')}</li>
            <li>{t('窗口近 1 年，取最后一个|Within 1Y, latest one')}</li>
          </ul>
        </div>
        <div>
          <div className="screen-caliber-title">{t('通用口径|General')}</div>
          <ul>
            <li>{t('涨停：与昨收比达板别上限（容差 0.05）|Limit-up vs prev close (tol 0.05)')}</li>
            <li>{t('趋势天数：近 1 年 MA30>MA60 最长连续|Trend days: longest MA30>MA60 run in 1Y')}</li>
            <li>{t('涨跌幅 =（今收 − 昨收）/ 昨收|Change = (close − prevClose) / prevClose')}</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
