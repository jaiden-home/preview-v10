'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import StarButton from '@/components/market/StarButton'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useLocale } from '@/components/terminal/useLocale'
import { runScreenerRequest } from '@/lib/chart/api'
import {
  SCREENER_INDICATORS,
  SCREENER_MAX_CONDITIONS,
  screenerIndicatorOf,
  type ScreenerCondition,
  type ScreenerIndicatorKey,
  type ScreenerRunView
} from '@/lib/screener/types'
import { screenerRequestError } from '@/lib/screener/validate'
import { loadWatchlist, persistWatchlist, toggleWatchItem, type WatchItem } from '@/lib/watchlist'

/** 策略持久化 key（条件组合 + 日期区间） */
const STRATEGY_KEY = 'klinecharts-screener-strategy'

/** 分片轮询间隔（done=false 时续算） */
const POLL_SLICE_MS = 1200

/** 新指标的默认条件（参数取元数据默认值，布尔指标 op=bool） */
const defaultCondition = (key: ScreenerIndicatorKey): ScreenerCondition => {
  const meta = screenerIndicatorOf(key)
  const params: Record<string, number> = {}
  meta?.params.forEach((param) => {
    params[param.name] = param.def
  })
  return { key, params, op: meta?.boolean ? 'bool' : 'gt', value: 0 }
}

const codeOf = (item: { market: string; ticker: string }): string => `${item.market}${item.ticker}`

const dirClass = (value: number | null): string => {
  if (value == null || value === 0) {
    return ''
  }
  return value > 0 ? 'up' : 'down'
}

const fmtNum = (value: number | null, digits = 2): string => (value == null ? '--' : value.toFixed(digits))

const fmtPct = (value: number | null): string => (value == null ? '--' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`)

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

/**
 * 量化选股页：条件组合器（指标 × 参数 × 运算符 × 阈值，AND 组合）+ 分片渐进运行。
 * 池 = 沪深主板（深 000 段 + 沪 600 段，服务端探测缓存）；结果行点击深链看板、星标入自选（与行情中心共用）。
 */
export default function Screener() {
  const { t } = useLocale()

  const [conditions, setConditions] = useState<ScreenerCondition[]>(() => [defaultCondition('rsi')])
  const [from, setFrom] = useState('')
  const [asOf, setAsOf] = useState('')
  const [running, setRunning] = useState(false)
  const [view, setView] = useState<ScreenerRunView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [watchlist, setWatchlist] = useState<WatchItem[]>([])
  const [dateBounds, setDateBounds] = useState<{ min: string; max: string }>({ min: '', max: '' })
  const runIdRef = useRef(0)

  // 挂载后回填：策略 + 自选（SSR 首帧用默认条件，避免水合不匹配）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWatchlist(loadWatchlist())
    try {
      const raw = window.localStorage.getItem(STRATEGY_KEY)
      if (raw != null) {
        const parsed = JSON.parse(raw) as {
          conditions?: ScreenerCondition[]
          from?: string
          asOf?: string
        }
        if (
          Array.isArray(parsed.conditions) &&
          parsed.conditions.length > 0 &&
          screenerRequestError({ conditions: parsed.conditions }) == null
        ) {
          setConditions(parsed.conditions)
        }
        if (typeof parsed.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.from)) {
          setFrom(parsed.from)
        }
        if (typeof parsed.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.asOf)) {
          setAsOf(parsed.asOf)
        }
      }
    } catch {
      // 损坏存储忽略，维持默认条件
    }
  }, [])

  // 策略变化即持久化
  useEffect(() => {
    window.localStorage.setItem(STRATEGY_KEY, JSON.stringify({ conditions, from, asOf }))
  }, [conditions, from, asOf])

  /** 结果表星标态：当前自选代码集合 */
  const watchedCodes = useMemo(() => new Set(watchlist.map(codeOf)), [watchlist])

  /** 截止日期可选范围：昨天 ~ 364 天前（与服务端一年护栏对齐；挂载后设置，渲染期不取钟） */
  useEffect(() => {
    const fmt = (offsetDays: number): string => {
      const date = new Date(Date.now() + offsetDays * 86_400_000)
      const month = `${date.getMonth() + 1}`.padStart(2, '0')
      const day = `${date.getDate()}`.padStart(2, '0')
      return `${date.getFullYear()}-${month}-${day}`
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDateBounds({ min: fmt(-364), max: fmt(-1) })
  }, [])

  /** 结果表的数值条件列（布尔条件恒命中，不单独成列） */
  const numericColumns = useMemo(() => {
    const seen = new Set<string>()
    const keys: Array<{ key: ScreenerIndicatorKey; label: string }> = []
    for (const condition of conditions) {
      const meta = screenerIndicatorOf(condition.key)
      if (meta != null && !meta.boolean && !seen.has(condition.key)) {
        seen.add(condition.key)
        keys.push({ key: condition.key, label: meta.label })
      }
    }
    return keys
  }, [conditions])

  /** 历史模式（起始/截止任一填写）与区间描述文案 */
  const historical = from !== '' || asOf !== ''
  const rangeLabel = useMemo(() => {
    if (from !== '' && asOf !== '') {
      return `${from} ~ ${asOf}`
    }
    if (from !== '') {
      return t(`自 ${from}|Since ${from}`)
    }
    if (asOf !== '') {
      return t(`截至 ${asOf}|As of ${asOf}`)
    }
    return ''
  }, [from, asOf, t])

  const changeKey = (index: number, key: ScreenerIndicatorKey) => {
    setConditions((prev) => prev.map((condition, i) => (i === index ? defaultCondition(key) : condition)))
  }

  const patchCondition = (index: number, patch: Partial<ScreenerCondition>) => {
    setConditions((prev) => prev.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)))
  }

  const changeParam = (index: number, name: string, meta: { min: number; max: number }, raw: string) => {
    const parsed = Number(raw)
    const value = Number.isFinite(parsed) ? Math.min(meta.max, Math.max(meta.min, Math.round(parsed))) : meta.min
    setConditions((prev) =>
      prev.map((condition, i) =>
        i === index ? { ...condition, params: { ...condition.params, [name]: value } } : condition
      )
    )
  }

  const changeNumber = (field: 'value' | 'min' | 'max', index: number, raw: string) => {
    const parsed = Number(raw)
    patchCondition(index, { [field]: Number.isFinite(parsed) ? parsed : 0 } as Partial<ScreenerCondition>)
  }

  const stop = () => {
    runIdRef.current += 1
    setRunning(false)
  }

  const run = async () => {
    if (running) {
      stop()
      return
    }
    const request = {
      conditions,
      from: from === '' ? undefined : from,
      asOf: asOf === '' ? undefined : asOf
    }
    const validation = screenerRequestError(request)
    if (validation != null) {
      setError(t(validation))
      return
    }
    runIdRef.current += 1
    const runId = runIdRef.current
    setRunning(true)
    setError(null)
    setView(null)
    while (runId === runIdRef.current) {
      const result = await runScreenerRequest(request)
      if (runId !== runIdRef.current) {
        return
      }
      if (!result.ok) {
        setError(t(result.message))
        break
      }
      setView(result.view)
      if (result.view.done) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_SLICE_MS))
    }
    if (runId === runIdRef.current) {
      setRunning(false)
    }
  }

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

  const progressPct = view != null && view.total > 0 ? Math.min(100, Math.round((view.computed / view.total) * 100)) : 0

  const technicalGroup = SCREENER_INDICATORS.filter((meta) => meta.kind === 'technical')
  const fundamentalGroup = SCREENER_INDICATORS.filter((meta) => meta.kind === 'fundamental')

  return (
    <div className="screener-page">
      <div className="screener-scroll">
        <div className="toolbar screener-toolbar">
          <div className="toolbar-item">
            <span className="home-brand">{t('量化选股|Stock Screener')}</span>
          </div>
          <ThemeToggle t={t} onToggle={toggleTheme} />
        </div>

        <div className="screener-main">
          <section className="trade-card screener-editor" aria-label={t('策略编辑|Strategy editor')}>
            <div className="market-card-head">
              <span className="market-card-title">{t('策略编辑|Strategy editor')}</span>
              <span className="market-card-sub">
                {t(
                  '指标 × 参数 × 运算符 × 阈值，多条件同时满足|Indicator × param × operator × threshold, all must match'
                )}
              </span>
            </div>
            <div className="screener-actions">
              <span className="screener-universe-hint">{t('池：沪深主板|Pool: SH/SZ main board')}</span>
              <label className="screener-asof">
                <span className="screener-param-label">{t('起始日期|From')}</span>
                <input
                  className="screener-date"
                  type="date"
                  value={from}
                  min={dateBounds.min}
                  max={asOf !== '' ? asOf : dateBounds.max}
                  aria-label={t('起始日期，留空为不限|From date, empty for unlimited')}
                  onChange={(event) => setFrom(event.target.value)}
                />
                {from !== '' && (
                  <button
                    className="screener-asof-clear"
                    type="button"
                    aria-label={t('清空起始日期|Clear from date')}
                    title={t('清空起始日期|Clear from date')}
                    onClick={() => setFrom('')}
                  >
                    ×
                  </button>
                )}
              </label>
              <label className="screener-asof">
                <span className="screener-param-label">{t('截止日期|As of')}</span>
                <input
                  className="screener-date"
                  type="date"
                  value={asOf}
                  min={from !== '' ? from : dateBounds.min}
                  max={dateBounds.max}
                  aria-label={t('截止日期，留空为最新|As-of date, empty for latest')}
                  onChange={(event) => setAsOf(event.target.value)}
                />
                {asOf !== '' && (
                  <button
                    className="screener-asof-clear"
                    type="button"
                    aria-label={t('恢复最新|Back to latest')}
                    title={t('恢复最新|Back to latest')}
                    onClick={() => setAsOf('')}
                  >
                    ×
                  </button>
                )}
              </label>
              <button className="screener-run" type="button" onClick={() => void run()}>
                {running ? t('停止|Stop') : t('运行筛选|Run screen')}
              </button>
            </div>
            <div className="screener-conditions">
              {conditions.map((condition, index) => {
                const meta = screenerIndicatorOf(condition.key)
                return (
                  <div className="screener-cond" key={index}>
                    <select
                      className="tb-select screener-key"
                      value={condition.key}
                      aria-label={t('指标|Indicator')}
                      onChange={(event) => changeKey(index, event.target.value as ScreenerIndicatorKey)}
                    >
                      <optgroup label={t('技术指标|Technical')}>
                        {technicalGroup.map((item) => (
                          <option key={item.key} value={item.key}>
                            {t(item.label)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={t('基本面|Fundamental')}>
                        {fundamentalGroup.map((item) => (
                          <option key={item.key} value={item.key}>
                            {t(item.label)}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {meta?.params.map((param) => (
                      <label key={param.name} className="screener-param">
                        <span className="screener-param-label">{t(param.label)}</span>
                        <input
                          className="screener-input"
                          type="number"
                          min={param.min}
                          max={param.max}
                          step={1}
                          value={condition.params[param.name]}
                          onChange={(event) => changeParam(index, param.name, param, event.target.value)}
                        />
                      </label>
                    ))}
                    {meta?.boolean ? (
                      <span className="screener-bool-tag">{t('命中|Match')}</span>
                    ) : (
                      <>
                        <select
                          className="tb-select"
                          value={condition.op}
                          aria-label={t('运算符|Operator')}
                          onChange={(event) =>
                            patchCondition(index, { op: event.target.value as ScreenerCondition['op'] })
                          }
                        >
                          <option value="gt">{t('大于|Above')}</option>
                          <option value="lt">{t('小于|Below')}</option>
                          <option value="between">{t('介于|Between')}</option>
                        </select>
                        {condition.op === 'between' ? (
                          <span className="screener-range">
                            <input
                              className="screener-input"
                              type="number"
                              aria-label={t('下限|Min')}
                              value={condition.min ?? 0}
                              onChange={(event) => changeNumber('min', index, event.target.value)}
                            />
                            <span className="screener-dash">~</span>
                            <input
                              className="screener-input"
                              type="number"
                              aria-label={t('上限|Max')}
                              value={condition.max ?? 0}
                              onChange={(event) => changeNumber('max', index, event.target.value)}
                            />
                          </span>
                        ) : (
                          <input
                            className="screener-input"
                            type="number"
                            step="any"
                            aria-label={t('阈值|Threshold')}
                            value={condition.value ?? 0}
                            onChange={(event) => changeNumber('value', index, event.target.value)}
                          />
                        )}
                      </>
                    )}
                    <button
                      className="screener-remove"
                      type="button"
                      aria-label={t('删除条件|Remove condition')}
                      disabled={conditions.length <= 1}
                      onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
            <button
              className="tb-btn screener-add"
              type="button"
              disabled={conditions.length >= SCREENER_MAX_CONDITIONS}
              onClick={() => setConditions((prev) => [...prev, defaultCondition('rsi')])}
            >
              + {t('添加条件|Add condition')}
            </button>
          </section>

          <section className="trade-card screener-results" aria-label={t('筛选结果|Screening results')}>
            <div className="market-card-head screener-results-head">
              <span className="market-card-title">
                {t('筛选结果|Results')}
                {view != null && <span className="screener-hit-count num">{view.items.length}</span>}
              </span>
              <span className="market-card-sub num">
                {view != null
                  ? `${rangeLabel !== '' ? `${rangeLabel} · ` : ''}${t(`已算 ${view.computed}/${view.total}|Scanned ${view.computed}/${view.total}`)}`
                  : rangeLabel !== ''
                    ? t('按历史区间行情筛选，任一日命中即算|Screening over the picked range, any hit day counts')
                    : t('运行筛选后展示命中标的|Run the screen to see matches')}
              </span>
            </div>
            {view != null && !view.done && (
              <div
                className="screener-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPct}
              >
                <span className="screener-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            )}
            {error != null && <div className="screener-error">{error}</div>}
            {view == null && error == null ? (
              <div className="trade-empty">
                {emptyIcon}
                <span className="trade-empty-title">
                  {running ? t('正在构建股票池数据|Building universe data') : t('尚未运行|Not run yet')}
                </span>
                <span className="trade-empty-sub">
                  {running
                    ? t(
                        '首次运行需拉取全池日K，约需一分钟|First run fetches daily bars for the whole pool, about a minute'
                      )
                    : t('自定义条件后点「运行筛选」|Build conditions, then run')}
                </span>
              </div>
            ) : view != null && view.done && view.items.length === 0 ? (
              <div className="trade-empty">
                {emptyIcon}
                <span className="trade-empty-title">{t('没有命中标的|No matches')}</span>
                <span className="trade-empty-sub">
                  {t('试试放宽阈值或减少条件|Try relaxing thresholds or removing conditions')}
                </span>
              </div>
            ) : view != null ? (
              <>
                <div className="trade-table-wrap screener-results-wrap">
                  <table className="trade-table">
                    <thead>
                      <tr>
                        <th className="txt-left">{t('标的|Symbol')}</th>
                        <th className="num">{t('现价|Price')}</th>
                        <th className="num">{t('涨跌幅|Change %')}</th>
                        {historical && <th className="num">{t('命中日|Hit date')}</th>}
                        {numericColumns.map((column) => (
                          <th key={column.key} className="num">
                            {t(column.label)}
                          </th>
                        ))}
                        <th className="num">{t('自选|Watch')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.items.map((item) => (
                        <tr key={item.code}>
                          <td className="txt-left">
                            <Link className="cell-symbol" href={`/dashboard?symbol=${item.code}`}>
                              <span className="cell-name">{item.name}</span>
                              <span className="cell-code">{item.code}</span>
                            </Link>
                          </td>
                          <td className={`num ${dirClass(item.changePct)}`}>{fmtNum(item.price)}</td>
                          <td className={`num ${dirClass(item.changePct)}`}>{fmtPct(item.changePct)}</td>
                          {historical && <td className="num screener-hit-date">{item.hitDate ?? '--'}</td>}
                          {numericColumns.map((column) => (
                            <td key={column.key} className="num">
                              {fmtNum(item.values[column.key] ?? null)}
                            </td>
                          ))}
                          <td className="num">
                            <StarButton
                              active={watchedCodes.has(item.code)}
                              title={
                                watchedCodes.has(item.code)
                                  ? t('移除自选|Remove from watchlist')
                                  : t('加入自选|Add to watchlist')
                              }
                              onToggle={() =>
                                toggleWatch({
                                  market: item.code.slice(0, 2),
                                  ticker: item.code.slice(2),
                                  name: item.name
                                })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="market-list">
                  {view.items.map((item) => (
                    <div className="market-item market-watch-item" key={item.code}>
                      <Link className="market-watch-link" href={`/dashboard?symbol=${item.code}`}>
                        <span className="market-watch-id">
                          <span className="cell-name">{item.name}</span>
                          <span className="cell-code">
                            {item.code}
                            {historical && item.hitDate != null ? ` · ${item.hitDate}` : ''}
                          </span>
                        </span>
                        <span className="market-watch-quote">
                          <span className={dirClass(item.changePct)}>{fmtNum(item.price)}</span>
                          <span className={dirClass(item.changePct)}>{fmtPct(item.changePct)}</span>
                        </span>
                      </Link>
                      <StarButton
                        active={watchedCodes.has(item.code)}
                        title={
                          watchedCodes.has(item.code)
                            ? t('移除自选|Remove from watchlist')
                            : t('加入自选|Add to watchlist')
                        }
                        onToggle={() =>
                          toggleWatch({ market: item.code.slice(0, 2), ticker: item.code.slice(2), name: item.name })
                        }
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}
