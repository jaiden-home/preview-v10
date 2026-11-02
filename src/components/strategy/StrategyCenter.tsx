'use client'

import { useCallback, useState } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useLocale } from '@/components/terminal/useLocale'
import type { StrategyBuy, StrategyData, StrategySell } from '@/lib/strategy/types'

/** 策略模拟（A‴ 方案）：Hero=最新交易日决策，资产卡=KPI+净值曲线，走查/持仓/成交/流水渐进披露 */

const money = (x: number): string => Math.round(x).toLocaleString('en-US')
const pct = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`
const pnlClass = (x: number): string => (x > 0 ? 'up' : x < 0 ? 'down' : '')

const buyText = (b: StrategyBuy): string => `${b.name} ${b.pct.toFixed(1)}%`
const sellText = (s: StrategySell): string => `${s.name} ${pct(s.pnlPct)}`

const FLOW_PREVIEW = 10

export default function StrategyCenter({ initialData }: { initialData: StrategyData | null }) {
  const { t } = useLocale()
  const [data, setData] = useState<StrategyData | null>(initialData)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flowAll, setFlowAll] = useState(false)
  const [walkAll, setWalkAll] = useState(false)

  const refresh = useCallback(async () => {
    if (refreshing) {
      return
    }
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/strategy?refresh=1', { cache: 'no-store' })
      const body = (await res.json()) as { ok?: boolean; data?: StrategyData; message?: string }
      if (body.ok === true && body.data != null) {
        setData(body.data)
      } else {
        setError(body.message ?? t('数据暂不可用|Data unavailable'))
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

  const lastDay = data?.days[data.days.length - 1] ?? null
  const curve = data?.equityCurve ?? []
  const curveMin = curve.length > 0 ? Math.min(...curve.map((p) => p.equity)) : 0
  const curveMax = curve.length > 0 ? Math.max(...curve.map((p) => p.equity)) : 0
  const span = curveMax - curveMin || 1
  // 坐标内缩：给 2px 描边与 r=3.5 终点圆点留边界余量，避免 viewBox 边缘截断
  const pt = (i: number, equity: number): [number, number] => [
    6 + (i / Math.max(1, curve.length - 1)) * 588,
    148 - ((equity - curveMin) / span) * 136
  ]
  const sparkPoints = curve.map((p, i) => pt(i, p.equity).join(',')).join(' ')
  const baseY = curve.length > 0 ? pt(0, data?.meta.params.capital ?? curveMin)[1] : 0
  const endPoint = curve.length > 0 ? pt(curve.length - 1, curve[curve.length - 1]?.equity ?? 0) : null
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
                  {t(
                    `日榜前${String(data.meta.params.walkN)}·周榜${String(data.meta.params.weeks)}周连升·涨幅${String(data.meta.params.pctLo)}~${String(data.meta.params.pctHi)}%·止盈${(data.meta.params.takeProfit * 100).toFixed(0)}%/保本·前${String(data.meta.params.maxPick)}只|Top${String(data.meta.params.walkN)} walk·${String(data.meta.params.weeks)}W rise·${String(data.meta.params.pctLo)}~${String(data.meta.params.pctHi)}%·TP${(data.meta.params.takeProfit * 100).toFixed(0)}%/breakeven·top${String(data.meta.params.maxPick)}`
                  )}
                </span>
              ) : null}
              <button type="button" className="tb-btn" disabled={refreshing} onClick={() => void refresh()}>
                {refreshing ? t('重算中…|Recomputing…') : t('刷新|Refresh')}
              </button>
            </div>
          </div>

          {data != null && lastDay != null ? (
            <>
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
                    <span className="strategy-card-title">{t('净值曲线|Equity curve')}</span>
                    <span className="stat-label num">
                      {money(curveMin)} ~ {money(curveMax)}
                    </span>
                  </div>
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
                    <polyline className="strategy-spark-line" points={sparkPoints} />
                    {endPoint != null ? (
                      <circle
                        className="strategy-spark-dot"
                        cx={endPoint[0].toFixed(1)}
                        cy={endPoint[1].toFixed(1)}
                        r="3.5"
                      />
                    ) : null}
                  </svg>
                  <div className="strategy-curve-axis">
                    <span className="stat-label num">{data.meta.startDate}</span>
                    <span className="stat-label num">
                      {data.meta.lastDate} · {money(data.summary.equity)}
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
