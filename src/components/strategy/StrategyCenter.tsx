'use client'

import { useCallback, useState } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useLocale } from '@/components/terminal/useLocale'
import { DEFAULT_B_POINT } from '@/lib/trading/signal'
import type { StrategyBundle, StrategyBuy, StrategyData, StrategySell } from '@/lib/strategy/types'

/** 策略模拟（A‴ 方案）：页首规则卡（版本 + 参数解释）→ 决策 Hero → 资产（多版本净值对比）→ 透视 → 持仓 → 成交 → 流水 */

const money = (x: number): string => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '-')
const pct = (x: number): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(2)}%` : '-')
const pnlClass = (x: number): string => (x > 0 ? 'up' : x < 0 ? 'down' : '')

const buyText = (b: StrategyBuy): string => `${b.name} ${b.pct.toFixed(1)}%`
const sellText = (s: StrategySell): string => `${s.name} ${pct(s.pnlPct)}`

const FLOW_PREVIEW = 10

export default function StrategyCenter({ initialBundle }: { initialBundle: StrategyBundle }) {
  const { t } = useLocale()
  const [bundle, setBundle] = useState<StrategyBundle>(initialBundle)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flowAll, setFlowAll] = useState(false)
  const [walkAll, setWalkAll] = useState(false)
  /** 版本折叠面板收起态（收起的版本 id）：默认全部收起（仅面板头一行），点击展开 */
  const [collapsed, setCollapsed] = useState<string[]>(() => [...initialBundle.order])

  const refresh = useCallback(async () => {
    if (refreshing) {
      return
    }
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/strategy?refresh=1', { cache: 'no-store' })
      // 成功 = 全版本束 { active, order, versions }（jsonOk 直出）；失败 = { error: { code, message } }
      const body = (await res.json()) as StrategyBundle | { error: { code: string; message: string } }
      if (res.ok && 'versions' in body) {
        setBundle(body)
      } else {
        setError(('error' in body ? body.error.message : null) ?? t('数据暂不可用|Data unavailable'))
      }
    } catch {
      setError(t('网络异常，请重试|Network error, retry'))
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

  const data = bundle.versions[bundle.active] ?? null
  /** 版本对比序列（注册序、剔除未就绪；≥2 条时净值曲线叠加 + 图例） */
  const series = bundle.order.map((id) => bundle.versions[id]).filter((d): d is StrategyData => d != null)
  const lastDay = data?.days[data.days.length - 1] ?? null
  const toggleVersion = (id: string): void => {
    setCollapsed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // 多版本净值曲线：并集日期为共享横轴、全序列共享纵轴刻度（同尺度才可比）
  const unionDates = [...new Set(series.flatMap((d) => d.equityCurve.map((p) => p.date)))].sort()
  const xIndexOf = new Map(unionDates.map((date, i) => [date, i]))
  const curveValues = series.flatMap((d) => d.equityCurve.map((p) => p.equity))
  const curveMin = curveValues.length > 0 ? Math.min(...curveValues) : 0
  const curveMax = curveValues.length > 0 ? Math.max(...curveValues) : 0
  const span = curveMax - curveMin || 1
  // 坐标内缩：给 2px 描边与 r=3.5 终点圆点留边界余量，避免 viewBox 边缘截断
  const pt = (i: number, equity: number): [number, number] => [
    6 + (i / Math.max(1, unionDates.length - 1)) * 588,
    148 - ((equity - curveMin) / span) * 136
  ]
  const baseY = unionDates.length > 0 ? pt(0, data?.meta.params.capital ?? curveMin)[1] : 0
  const seriesPoints = series.map((d) =>
    d.equityCurve.map((p) => pt(xIndexOf.get(p.date) ?? 0, p.equity).join(',')).join(' ')
  )
  const seriesEnds = series.map((d) => {
    const last = d.equityCurve[d.equityCurve.length - 1]
    return last != null ? pt(xIndexOf.get(last.date) ?? 0, last.equity) : null
  })
  const flowRows = flowAll
    ? [...(data?.days ?? [])].reverse()
    : [...(data?.days ?? [])].reverse().slice(0, FLOW_PREVIEW)

  return (
    <div className="screener-page">
      <div className="screener-scroll">
        <div className="toolbar screener-toolbar">
          <div className="toolbar-item">
            <span className="home-brand">{t('策略模拟|Strategy Sim')}</span>
          </div>
          <ThemeToggle t={t} onToggle={toggleTheme} />
        </div>

        <div className="screener-main">
          <div className="screen-tabs-row">
            <div className="screen-meta">
              {data != null ? (
                <span
                  className="screen-date-badge num"
                  title={t('快照数据截至 / 策略起始|Data as of / strategy start')}
                >
                  {t(`截至|As of`)} {data.meta.lastDate} · {t(`起|From`)} {data.meta.startDate}
                </span>
              ) : null}
              {data != null ? (
                <span className="strategy-params-badge num" title={t('策略参数|Strategy params')}>
                  {`${data.meta.version} · ${t(
                    `日榜前${String(data.meta.params.walkN)}·周榜${String(data.meta.params.weeks)}周连升·涨幅${String(data.meta.params.pctLo)}~${String(data.meta.params.pctHi)}%·止盈${(data.meta.params.takeProfit * 100).toFixed(0)}%/保本·前${String(data.meta.params.maxPick)}只|Top${String(data.meta.params.walkN)} walk·${String(data.meta.params.weeks)}W rise·${String(data.meta.params.pctLo)}~${String(data.meta.params.pctHi)}%·TP${(data.meta.params.takeProfit * 100).toFixed(0)}%/breakeven·top${String(data.meta.params.maxPick)}`
                  )}`}
                </span>
              ) : null}
              <button type="button" className="tb-btn" disabled={refreshing} onClick={() => void refresh()}>
                {refreshing ? t('重算中…|Recomputing…') : t('刷新|Refresh')}
              </button>
            </div>
          </div>

          {data != null && lastDay != null ? (
            <>
              {/* 卡 0 · 策略规则（页首）：当前执行版本 + 总则一行 + 参数解释表（说明列承载规则语境，多版本并列对比） */}
              <section className="trade-card strategy-card" aria-label={t('策略规则|Strategy rules')}>
                <div className="strategy-card-head">
                  <span className="strategy-card-title">{t('策略规则|Strategy rules')}</span>
                  <span className="strategy-version-badge">
                    {t('当前执行|Running')} <span className="num">{data.meta.version}</span>
                    {series.length > 1 ? t(' · 多版本曲线对比中| · curve comparison on') : ''}
                  </span>
                </div>
                <p className="strategy-version-label">
                  {t(
                    '总则：先卖后买 · 全部收盘价成交 · 事实 T+1 · 停牌继续持有 · 股票池 = 选股中心领涨股表（同源）· 一股一概念 · 改条件 = 追加新版本对比|Framework: sell first · fills at close · T+1 · hold if suspended · stock pool = screener leader board (same source) · one concept per stock · changing rules = appending a version'
                  )}
                </p>
                {/* 版本折叠面板（Collapse）：点头部整版收起/展开；当前执行版本品牌蓝描边 + 「当前」标签 */}
                <div className="strategy-versions">
                  {series.map((d, idx) => {
                    const isActive = d.meta.version === bundle.active
                    const open = !collapsed.includes(d.meta.version)
                    return (
                      <div
                        key={d.meta.version}
                        className={`strategy-ver-panel${isActive ? ' active' : ''}${open ? '' : ' closed'}`}
                      >
                        <button
                          type="button"
                          className="strategy-ver-head"
                          aria-expanded={open}
                          title={t('收起 / 展开该版本参数|Collapse / expand this version')}
                          onClick={() => toggleVersion(d.meta.version)}
                        >
                          <span className={`strategy-legend-dot${idx > 0 ? ' alt' : ''}`} />
                          <span className="num">{d.meta.version}</span>
                          {isActive ? <span className="strategy-tag sell">{t('当前|current')}</span> : null}
                          <span className="strategy-ver-label">{d.meta.versionLabel}</span>
                          <svg
                            className="strategy-ver-chevron"
                            viewBox="0 0 12 12"
                            width="12"
                            height="12"
                            aria-hidden="true"
                          >
                            <path
                              d="M2.5 4.5L6 8l3.5-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        {open ? (
                          <div className="strategy-ver-body">
                            <table className="strategy-table wrap strategy-params-table">
                              <thead>
                                <tr>
                                  <th>{t('参数|Param')}</th>
                                  <th>{t('说明|Description')}</th>
                                  <th className="num">{d.meta.version}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(
                                  [
                                    {
                                      key: 'start',
                                      name: t('起始日|Start'),
                                      desc: t(
                                        '回放起点（含）；无截止日，随数据自动延伸|Replay start (incl.); open-ended, extends with data'
                                      ),
                                      value: (d: StrategyData) => d.meta.startDate
                                    },
                                    {
                                      key: 'walkN',
                                      name: t('日榜走查深度|Day-rank walk depth'),
                                      desc: t(
                                        '只在前 N 名板块里逐个找「连升 + 有候选」，走到即停|Walk top N day ranks for rising + candidates; stop at first pass'
                                      ),
                                      value: (d: StrategyData) => String(d.meta.params.walkN)
                                    },
                                    {
                                      key: 'weeks',
                                      name: t('周榜连升快照数|Week-rank snapshots'),
                                      desc: t(
                                        '榜 = 成分股平均涨幅（周榜对 7 自然日前最近交易日）；名次 两周前→上周→本周 连升，且今日 < 昨日|Ranks = member-average change (week vs ~7 calendar days ago); rising across snapshots, today < yesterday'
                                      ),
                                      value: (d: StrategyData) => String(d.meta.params.weeks)
                                    },
                                    {
                                      key: 'pct',
                                      name: t('候选当日涨幅区间|Candidate daily change'),
                                      desc: t(
                                        '属选股中心股票池（领涨股表）、当日出 B 点、涨幅落在开区间内且未持仓才成候选（不含端点）|In the screener leader pool, B-point today, change inside the open range, and not held'
                                      ),
                                      value: (d: StrategyData) =>
                                        `${String(d.meta.params.pctLo)}~${String(d.meta.params.pctHi)}%`
                                    },
                                    {
                                      key: 'bPoint',
                                      name: t('买入点（B 点）|Buy point (B)'),
                                      desc: t(
                                        '连续 N 日强涨的末日出 B 点：高点容差 + MA 门槛 + 动能保护（详见下方 B 点块）|B-point at end of an N-day strong run: tolerance + MA gate + momentum guard (see block below)'
                                      ),
                                      value: (d: StrategyData) => {
                                        const b = d.meta.params.bPoint ?? DEFAULT_B_POINT
                                        return `${String(b.runDays)}日·×${String(b.highTol)}·MA${String(b.maDays)}·${(b.tailRepairMin * 100).toFixed(0)}%/${(b.fadeRatio * 100).toFixed(0)}%`
                                      }
                                    },
                                    {
                                      key: 'takeProfit',
                                      name: t('止盈线|Take profit'),
                                      desc: t('收盘 ≥ 买入价×(1+N%) 即止盈离场|Exit at close ≥ buy×(1+N%)'),
                                      value: (d: StrategyData) => `+${(d.meta.params.takeProfit * 100).toFixed(0)}%`
                                    },
                                    {
                                      key: 'stopBuffer',
                                      name: t('保本止损缓冲|Breakeven buffer'),
                                      desc: t(
                                        '收盘 < 买入价×(1−N%) 即保本离场；0 = 无缓冲，跌破买入价即离场|Exit at close < buy×(1−N%); 0 = no buffer'
                                      ),
                                      value: (d: StrategyData) =>
                                        `${((d.meta.params.stopBuffer ?? 0) * 100).toFixed(1)}%`
                                    },
                                    {
                                      key: 'maxPick',
                                      name: t('单板块持仓上限|Per-sector cap'),
                                      desc: t(
                                        '候选按均线比 MA30÷MA60 降序取前 N，资金均分|Top N candidates by MA30÷MA60, cash split evenly'
                                      ),
                                      value: (d: StrategyData) => String(d.meta.params.maxPick)
                                    },
                                    {
                                      key: 'capital',
                                      name: t('初始资金|Initial capital'),
                                      desc: t('元；全部版本同起点可比|CNY; same start for all versions'),
                                      value: (d: StrategyData) => money(d.meta.params.capital)
                                    }
                                  ] as Array<{
                                    key: string
                                    name: string
                                    desc: string
                                    value: (d: StrategyData) => string
                                  }>
                                ).map((row) => (
                                  <tr key={row.key}>
                                    <td>{row.name}</td>
                                    <td className="desc">{row.desc}</td>
                                    <td className="num">{row.value(d)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* 卡 1 · 决策流水带（Hero）：最近 5 个交易日的决策账本，最新在左 */}
              <section className="trade-card strategy-card strategy-hero" aria-label={t('决策流水|Decision ledger')}>
                <div className="strategy-hero-head">
                  <span className="strategy-card-title">{t('决策流水|Decision ledger')}</span>
                  <span className="stat-label">
                    {t('最新在左，「今」为最近交易日|Latest first; 今 = latest trading day')}
                  </span>
                </div>
                <div className="strategy-ledger">
                  {[...data.days]
                    .slice(-5)
                    .reverse()
                    .map((d, idx) => (
                      <div key={d.date} className={`strategy-ledger-col${idx === 0 ? ' today' : ''}`}>
                        <span className="strategy-ledger-date num">
                          {idx === 0 ? <span className="strategy-today-mark">{t('今|Today')}</span> : null}
                          {d.date.slice(5)}
                        </span>
                        {d.selected != null ? (
                          <>
                            <span className="strategy-pick-name">{d.selected.concept}</span>
                            <span className="strategy-pick-chain num">
                              {t(`周榜|Week`)} {d.selected.chain} · {t(`日榜|Day`)} {String(d.selected.rank)}
                              {d.selected.rD != null ? ` · ${t(`昨|prev`)} ${String(d.selected.rD)}` : ''}
                            </span>
                          </>
                        ) : (
                          <span className="strategy-ledger-idle">{t('空仓等待|In cash')}</span>
                        )}
                        {d.buys.length > 0 ? (
                          <span className="strategy-chip-row">
                            {d.buys.map((b) => (
                              <span key={b.code} className="strategy-chip buy">
                                <span>{b.name}</span>
                                <span className="num">{pct(b.pct)}</span>
                              </span>
                            ))}
                          </span>
                        ) : null}
                        {d.sells.length > 0 ? (
                          <span className="strategy-chip-row">
                            {d.sells.map((s) => (
                              <span key={s.code} className="strategy-chip sell">
                                <span>{s.name}</span>
                                <span className={`num ${pnlClass(s.pnlPct)}`}>{pct(s.pnlPct)}</span>
                                <span className="chip-note">
                                  {s.reason === 'takeprofit' ? t('止盈|TP') : t('保本|BE')}
                                </span>
                              </span>
                            ))}
                          </span>
                        ) : null}
                        <span className="strategy-ledger-equity num">{money(d.equity)}</span>
                      </div>
                    ))}
                </div>
              </section>

              {/* 卡 2 · 资产：主 KPI + 净值曲线并排 */}
              <section className="trade-card strategy-card strategy-asset" aria-label={t('资产概览|Asset overview')}>
                <div className="strategy-tape">
                  <span className="strategy-tape-cell main">
                    <span className="stat-label">{t('期末净值|Equity')}</span>
                    <span className="strategy-kpi-main num">{money(data.summary.equity)}</span>
                    <span className={`strategy-kpi-return num ${pnlClass(data.summary.returnPct)}`}>
                      {pct(data.summary.returnPct)}
                    </span>
                  </span>
                  <span className="strategy-tape-cell">
                    <span className="stat-label">{t('现金|Cash')}</span>
                    <span className="stat-value num">{money(data.summary.cash)}</span>
                  </span>
                  <span className="strategy-tape-cell">
                    <span className="stat-label">{t('持仓市值|Position value')}</span>
                    <span className="stat-value num">{money(data.summary.marketValue)}</span>
                  </span>
                  <span className="strategy-tape-cell">
                    <span className="stat-label">{t('平仓 / 胜|Closed / wins')}</span>
                    <span className="stat-value num">
                      {String(data.summary.closedCount)} / {String(data.summary.winCount)}
                    </span>
                  </span>
                  <span className="strategy-tape-cell">
                    <span className="stat-label">{t('交易日|Trading days')}</span>
                    <span className="stat-value num">{String(data.meta.tradingDays)}</span>
                  </span>
                </div>
                <div className="strategy-curve">
                  <div className="strategy-card-head">
                    <span className="strategy-card-title">
                      {t('净值曲线|Equity curve')}
                      {series.length > 1 ? t('（版本对比，同尺度）| (version comparison, same scale)') : ''}
                    </span>
                    <span className="stat-label num">
                      {money(curveMin)} ~ {money(curveMax)}
                    </span>
                  </div>
                  {series.length > 1 ? (
                    <div className="strategy-curve-legend">
                      {series.map((d, idx) => (
                        <span
                          key={d.meta.version}
                          className={`strategy-legend-chip${idx > 0 ? ' alt' : ''}${
                            d.meta.version === bundle.active ? ' active' : ''
                          }`}
                        >
                          <span className="strategy-legend-dot" />
                          <span className="num">{d.meta.version}</span>
                          <span className={`num ${pnlClass(d.summary.returnPct)}`}>{pct(d.summary.returnPct)}</span>
                          {d.meta.version === bundle.active ? (
                            <span className="chip-note">{t('当前|current')}</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <svg className="strategy-spark" viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true">
                    {data.summary.equity >= data.meta.params.capital ? (
                      <line
                        className="strategy-spark-base"
                        x1="0"
                        x2="600"
                        y1={baseY.toFixed(1)}
                        y2={baseY.toFixed(1)}
                      />
                    ) : null}
                    {seriesPoints.map((points, idx) => (
                      <polyline
                        key={series[idx]?.meta.version ?? idx}
                        className={`strategy-spark-line${idx > 0 ? ' alt' : ''}`}
                        points={points}
                      />
                    ))}
                    {seriesEnds.map((end, idx) =>
                      end != null ? (
                        <circle
                          key={series[idx]?.meta.version ?? idx}
                          className={`strategy-spark-dot${idx > 0 ? ' alt' : ''}`}
                          cx={end[0].toFixed(1)}
                          cy={end[1].toFixed(1)}
                          r="3.5"
                        />
                      ) : null
                    )}
                  </svg>
                  <div className="strategy-curve-axis">
                    <span className="stat-label num">{unionDates[0] ?? data.meta.startDate}</span>
                    <span className="stat-label num">
                      {unionDates[unionDates.length - 1] ?? data.meta.lastDate} · {t('当前|current')}{' '}
                      {data.meta.version} {money(data.summary.equity)}
                    </span>
                  </div>
                </div>
              </section>

              {/* 卡 3 · 走查透视（走到即停：入选后不再走查后续名次） */}
              <section className="trade-card strategy-card" aria-label={t('日榜走查透视|Day-rank walk-through')}>
                <div className="strategy-card-head">
                  <span className="strategy-card-title">{t('日榜走查透视|Day-rank walk-through')}</span>
                  {lastDay.selected != null ? (
                    <span className="stat-label">
                      {t(
                        `走到第 ${String(lastDay.selected.rank)} 名即入选，后续未走查|Stopped at rank ${String(lastDay.selected.rank)} — rest not walked`
                      )}
                    </span>
                  ) : (
                    <span className="stat-label">
                      {t(
                        `前 ${String(data.meta.params.walkN)} 名逐个校验「三周连升 + 有候选」|Top ${String(data.meta.params.walkN)} sectors checked for rising + candidates`
                      )}
                    </span>
                  )}
                </div>
                <div className="strategy-table-wrap">
                  <table className="strategy-table">
                    <thead>
                      <tr>
                        <th className="num">{t('日榜|Rank')}</th>
                        <th>{t('板块|Sector')}</th>
                        <th className="num">{t('日涨幅|Day chg')}</th>
                        <th className="num">{t('周榜链（两周前→本周）|Week chain (W-2→now)')}</th>
                        <th className="num">{t('昨|Prev')}</th>
                        <th>{t('状态|Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(lastDay.selected != null && !walkAll
                        ? data.latest.walk.filter((row) => row.rank <= (lastDay.selected?.rank ?? 0))
                        : data.latest.walk
                      ).map((row) => {
                        const picked = lastDay.selected?.concept === row.concept
                        const rowCls = picked ? 'picked' : row.rising ? 'rising' : 'dim'
                        return (
                          <tr key={row.concept} className={rowCls}>
                            <td className="num">{String(row.rank)}</td>
                            <td>{row.concept}</td>
                            <td className={`num ${pnlClass(row.dayAvg)}`}>{pct(row.dayAvg)}</td>
                            <td className="num">{row.chain}</td>
                            <td className="num">{row.rD != null ? String(row.rD) : '-'}</td>
                            <td>
                              {picked ? (
                                <span className="strategy-tag tp">{t('入选·买入|Pick · buy')}</span>
                              ) : row.rising ? (
                                <span className="strategy-tag be">{t('连升·无候选|Rising · no candidate')}</span>
                              ) : (
                                <span className="strategy-tag dim">{t('未连升|Not rising')}</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {lastDay.selected != null && data.latest.walk.length > lastDay.selected.rank ? (
                  <div className="strategy-walk-more">
                    <button type="button" className="tb-btn" onClick={() => setWalkAll((v) => !v)}>
                      {walkAll
                        ? t('只看走过的名次|Walked ranks only')
                        : t(
                            `后面还有 ${String(data.latest.walk.length - lastDay.selected!.rank)} 名（未走查）|${String(data.latest.walk.length - lastDay.selected!.rank)} more ranks (not walked)`
                          )}
                    </button>
                  </div>
                ) : null}
              </section>

              {/* 卡 4 · 当前持仓 */}
              <section className="trade-card strategy-card" aria-label={t('当前持仓|Positions')}>
                <div className="strategy-card-head">
                  <span className="strategy-card-title">{t('当前持仓|Positions')}</span>
                  <span className="stat-label num">{String(data.positions.length)}</span>
                </div>
                {data.positions.length > 0 ? (
                  <div className="strategy-table-wrap">
                    <table className="strategy-table">
                      <thead>
                        <tr>
                          <th>{t('代码|Code')}</th>
                          <th>{t('名称|Name')}</th>
                          <th>{t('板块|Sector')}</th>
                          <th className="num">{t('买入日|Buy date')}</th>
                          <th className="num">{t('成本|Cost')}</th>
                          <th className="num">{t('现价|Last')}</th>
                          <th className="num">{t('浮动|Float')}</th>
                          <th className="num">{t('市值|Value')}</th>
                          <th className="num">{t('距止盈|To TP')}</th>
                          <th className="num">{t('保本缓冲|Cushion')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.positions.map((p) => (
                          <tr key={p.code}>
                            <td className="num cell-code">{p.code}</td>
                            <td>{p.name}</td>
                            <td>{p.concept}</td>
                            <td className="num">{p.buyDate}</td>
                            <td className="num">{p.buyPrice.toFixed(2)}</td>
                            <td className="num">{p.lastClose.toFixed(2)}</td>
                            <td className={`num ${pnlClass(p.floatPct)}`}>{pct(p.floatPct)}</td>
                            <td className="num">{money(p.value)}</td>
                            <td className="num">{pct(p.toTp)}</td>
                            <td className={`num ${pnlClass(p.toStop)}`}>{pct(p.toStop)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="strategy-empty-row">
                    {t('空仓等待信号（有资金、无入选板块或候选）|In cash, waiting for a pick')}
                  </p>
                )}
              </section>

              {/* 卡 5 · 成交记录 */}
              <section className="trade-card strategy-card" aria-label={t('成交记录|Trades')}>
                <div className="strategy-card-head">
                  <span className="strategy-card-title">{t('成交记录|Trades')}</span>
                  <span className="stat-label num">
                    {String(data.summary.closedCount)} · {t(`胜率|Win`)}{' '}
                    {data.summary.closedCount > 0
                      ? `${((data.summary.winCount / data.summary.closedCount) * 100).toFixed(0)}%`
                      : '-'}
                  </span>
                </div>
                {data.trades.length > 0 ? (
                  <div className="strategy-table-wrap">
                    <table className="strategy-table">
                      <thead>
                        <tr>
                          <th>{t('代码|Code')}</th>
                          <th>{t('名称|Name')}</th>
                          <th>{t('板块|Sector')}</th>
                          <th className="num">{t('买入|Buy')}</th>
                          <th className="num">{t('卖出|Sell')}</th>
                          <th className="num">{t('持|Hold')}</th>
                          <th className="num">{t('收益率|Return')}</th>
                          <th className="num">{t('盈亏|P&L')}</th>
                          <th>{t('离场|Exit')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.trades.map((tr) => (
                          <tr key={`${tr.code}-${tr.buyDate}`}>
                            <td className="num cell-code">{tr.code}</td>
                            <td>{tr.name}</td>
                            <td>{tr.concept}</td>
                            <td className="num">
                              {tr.buyDate} @ {tr.buyPrice.toFixed(2)}
                            </td>
                            <td className="num">
                              {tr.sellDate} @ {tr.sellPrice.toFixed(2)}
                            </td>
                            <td className="num">{String(tr.holdDays)}</td>
                            <td className={`num ${pnlClass(tr.pnlPct)}`}>{pct(tr.pnlPct)}</td>
                            <td className={`num ${pnlClass(tr.pnl)}`}>{money(tr.pnl)}</td>
                            <td>
                              <span className={`strategy-tag ${tr.reason === 'takeprofit' ? 'sell' : 'be'}`}>
                                {tr.reason === 'takeprofit' ? t('止盈|Take profit') : t('保本|Breakeven')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="strategy-empty-row">{t('暂无平仓记录|No closed trades yet')}</p>
                )}
              </section>

              {/* 卡 6 · 每日流水（渐进披露：默认最近 10 行） */}
              <section className="trade-card strategy-card" aria-label={t('每日流水|Daily flow')}>
                <div className="strategy-card-head">
                  <span className="strategy-card-title">{t('每日流水|Daily flow')}</span>
                  <button type="button" className="tb-btn" onClick={() => setFlowAll((v) => !v)}>
                    {flowAll
                      ? t('收起|Collapse')
                      : t(
                          `显示全部 ${String(data.meta.tradingDays)} 行|Show all ${String(data.meta.tradingDays)} rows`
                        )}
                  </button>
                </div>
                <div className="strategy-table-wrap">
                  <table className="strategy-table">
                    <thead>
                      <tr>
                        <th className="num">{t('日期|Date')}</th>
                        <th>{t('入选板块|Pick')}</th>
                        <th>{t('买入|Buys')}</th>
                        <th>{t('卖出|Sells')}</th>
                        <th className="num">{t('现金|Cash')}</th>
                        <th className="num">{t('净值|Equity')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flowRows.map((d) => (
                        <tr key={d.date} className={d.selected != null ? 'rising' : undefined}>
                          <td className="num">{d.date}</td>
                          <td>{d.selected != null ? `${d.selected.concept}(${String(d.selected.rank)})` : '-'}</td>
                          <td className="num">{d.buys.length > 0 ? d.buys.map(buyText).join(' · ') : '-'}</td>
                          <td className="num">{d.sells.length > 0 ? d.sells.map(sellText).join(' · ') : '-'}</td>
                          <td className="num">{money(d.cash)}</td>
                          <td className="num">{money(d.equity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <section className="trade-card">
              <div className="trade-empty">
                <span className="trade-empty-title">{t('策略数据尚未就绪|Strategy data not ready')}</span>
                <span className="trade-empty-sub">
                  {refreshing
                    ? t('全量回放计算中，约需数秒~半分钟|Replaying the strategy, may take a while')
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
          )}
        </div>
      </div>
    </div>
  )
}
