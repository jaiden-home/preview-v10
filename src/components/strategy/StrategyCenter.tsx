'use client'

import { useCallback, useState } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useLocale } from '@/components/terminal/useLocale'
import type { StrategyBuy, StrategyData, StrategySell } from '@/lib/strategy/types'

/** 策略模拟（A‴ 方案）：日榜走查 + 周榜三周连升 + B 点选股；保本止损 / 3% 止盈（收盘价成交） */

const money = (x: number): string => Math.round(x).toLocaleString('en-US')
const pct = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`
const pnlClass = (x: number): string => (x > 0 ? 'up' : x < 0 ? 'down' : '')

const buyText = (b: StrategyBuy): string => `${b.name} ${b.pct.toFixed(1)}%`
const sellText = (s: StrategySell): string => `${s.name} ${pct(s.pnlPct)}`

export default function StrategyCenter({ initialData }: { initialData: StrategyData | null }) {
  const { t } = useLocale()
  const [data, setData] = useState<StrategyData | null>(initialData)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (refreshing) {
      return
    }
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/strategy?refresh=1', { cache: 'no-store' })
      const body = (await res.json()) as { ok: boolean; data?: StrategyData; message?: string }
      if (body.ok && body.data != null) {
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
  const sparkPoints =
    curve.length > 1
      ? curve
          .map((p, i) => {
            const x = (i / (curve.length - 1)) * 600
            const span = curveMax - curveMin || 1
            const y = 150 - ((p.equity - curveMin) / span) * 140
            return `${x.toFixed(1)},${y.toFixed(1)}`
          })
          .join(' ')
      : ''
  const baseY =
    curveMax > 0 ? 150 - ((data?.meta.params.capital ?? 1e6 - curveMin) / (curveMax - curveMin || 1)) * 140 : 0

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
              <section className="trade-card strategy-summary" aria-label={t('策略概览|Strategy overview')}>
                <div className="strategy-stats">
                  <span className="stat-cell">
                    <span className="stat-label">{t('期末净值|Equity')}</span>
                    <span className="stat-value num">{money(data.summary.equity)}</span>
                  </span>
                  <span className="stat-cell">
                    <span className="stat-label">{t('总收益|Return')}</span>
                    <span className={`stat-value num ${pnlClass(data.summary.returnPct)}`}>
                      {pct(data.summary.returnPct)}
                    </span>
                  </span>
                  <span className="stat-cell">
                    <span className="stat-label">{t('现金|Cash')}</span>
                    <span className="stat-value num">{money(data.summary.cash)}</span>
                  </span>
                  <span className="stat-cell">
                    <span className="stat-label">{t('持仓市值|Position value')}</span>
                    <span className="stat-value num">{money(data.summary.marketValue)}</span>
                  </span>
                  <span className="stat-cell">
                    <span className="stat-label">{t('平仓 / 胜|Closed / wins')}</span>
                    <span className="stat-value num">
                      {String(data.summary.closedCount)} / {String(data.summary.winCount)}
                    </span>
                  </span>
                  <span className="stat-cell">
                    <span className="stat-label">{t('交易日|Trading days')}</span>
                    <span className="stat-value num">{String(data.meta.tradingDays)}</span>
                  </span>
                </div>
              </section>

              <section className="trade-card strategy-curve" aria-label={t('净值曲线|Equity curve')}>
                <div className="strategy-card-head">
                  <span className="strategy-card-title">{t('净值曲线|Equity curve')}</span>
                  <span className="stat-label num">
                    {money(curveMin)} ~ {money(curveMax)}
                  </span>
                </div>
                <svg className="strategy-spark" viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true">
                  {data.summary.equity >= data.meta.params.capital ? (
                    <line className="strategy-spark-base" x1="0" x2="600" y1={baseY.toFixed(1)} y2={baseY.toFixed(1)} />
                  ) : null}
                  <polyline className="strategy-spark-line" points={sparkPoints} />
                </svg>
                <div className="strategy-curve-axis">
                  <span className="stat-label num">{data.meta.startDate}</span>
                  <span className="stat-label num">{data.meta.lastDate}</span>
                </div>
              </section>

              <section className="trade-card" aria-label={t('最新决策|Latest decisions')}>
                <div className="strategy-card-head">
                  <span className="strategy-card-title">
                    {t('最新决策|Latest decisions')} · <span className="num">{data.latest.date}</span>
                  </span>
                  {lastDay.selected != null ? (
                    <span className="strategy-tag tp num">
                      {t(`入选|Pick`)} {lastDay.selected.concept} · {t(`日榜|Day`)} {String(lastDay.selected.rank)} ·
                      周榜 {lastDay.selected.chain}
                    </span>
                  ) : (
                    <span className="strategy-tag be">{t('前 20 名无入选|No pick in top 20')}</span>
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
                      {data.latest.walk.map((row) => {
                        const picked = lastDay.selected?.concept === row.concept
                        return (
                          <tr key={row.concept} className={picked ? 'picked' : undefined}>
                            <td className="num">{String(row.rank)}</td>
                            <td>{row.concept}</td>
                            <td className="num">{pct(row.dayAvg)}</td>
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
                {lastDay.buys.length > 0 || lastDay.sells.length > 0 ? (
                  <div className="strategy-day-actions">
                    {lastDay.buys.length > 0 ? (
                      <p>
                        <span className="strategy-tag tp">{t('买入|Buy')}</span>{' '}
                        <span className="num">{lastDay.buys.map(buyText).join(' · ')}</span>
                      </p>
                    ) : null}
                    {lastDay.sells.length > 0 ? (
                      <p>
                        <span className="strategy-tag sell">{t('卖出|Sell')}</span>{' '}
                        <span className="num">{lastDay.sells.map(sellText).join(' · ')}</span>
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="trade-card" aria-label={t('当前持仓|Positions')}>
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

              <section className="trade-card" aria-label={t('成交记录|Trades')}>
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

              <section className="trade-card" aria-label={t('每日流水|Daily flow')}>
                <div className="strategy-card-head">
                  <span className="strategy-card-title">{t('每日流水|Daily flow')}</span>
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
                      {[...data.days].reverse().map((d) => (
                        <tr key={d.date}>
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
