'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import PeriodGroup from '@/components/terminal/PeriodGroup'
import ChartTools from '@/components/terminal/ChartTools'
import InfoTable from '@/components/terminal/InfoTable'
import { useLocale } from '@/components/terminal/useLocale'
import { useChartTerminal } from '@/components/terminal/useChartTerminal'
import { fetchQuoteSnapshot } from '@/lib/chart/api'
import { POLL_INTERVAL_MS } from '@/lib/chart/constants'
import { createReplayFeed } from '@/lib/chart/replay-loader'
import type { InfoSnapshot } from '@/lib/chart/terminal'
import type { QuoteSnapshot } from '@/lib/chart/types'
import SimClockBar from '@/components/simtrade/SimClockBar'
import { useReplay } from '@/components/simtrade/useReplay'
import { REPLAY_SPEEDS, releaseAllFrozen, type ReplaySpeedMs } from '@/lib/trading/replay'
import { postSimOrder } from '@/lib/trading/sim-api'
import OrderPanel from './OrderPanel'
import PositionsTable from './PositionsTable'
import TradesTable from './TradesTable'
import TradeSummary from './TradeSummary'
import {
  REPLAY_SYMBOL_STORAGE_KEY,
  calcEquity,
  fmtMoney,
  fmtPct,
  fmtSignedMoney,
  loadSelectedSymbol,
  dayKeyOf,
  round2,
  unfreezePositions,
  type TradeSide,
  type TradingAccount
} from '@/lib/trading/account'

/** 极速模拟默认标的（sh600999 招商证券；锚定共享交易日历，不可交易标的会被下单校验拦截） */
const DEFAULT_TRADING_SYMBOL = { market: 'sh', ticker: '600999' }

interface TradeNotice {
  kind: 'ok' | 'err'
  text: string
}

/**
 * 极速模拟页（/simtrade）：虚拟时钟 + 历史 K 线回放（UI_SPEC §3.13）。
 * 日原子模型：开局选定起始日后第 1 个交易日立即完成（整根 K 线出现），
 * 每过倍速时长（15/30/60 秒）推进下一交易日，走满即本局结束。
 * **交易账务（账户/持仓/成交/回放会话/虚拟时钟）全部由 BFF 权威结算（node:sqlite 持久化）**：
 * 本组件只做展示与请求——下单走 /api/sim/orders，会话控制走 /api/sim/session；
 * running 期间虚拟日推进由本地时钟派生（回放数据不可变，无需轮询），
 * 任何服务端交互的响应都会校准权威状态（跨日账务先本地推导展示，服务端结算覆盖校准）。
 * 行情分两段：**未开局 = 与 /trade 完全一致（图表实时完整日 K + order-head 实时行情，
 * 可按实时价交易、记真实日期）**；
 * **开局后 = 回放（图表切为起始日前历史 + 逐日推进，order-head 现价 = 最新完成日收盘，
 * 与图表一致，仅随虚拟日推进变化）**，
 * T+1/涨跌停按虚拟日结算（服务端）；开局时真实日期建仓视为历史持仓直接解冻。
 * 选中标的仍用独立 localStorage key，与 /trade 互不干扰。
 */
export default function SimTrading() {
  const { locale, t } = useLocale()

  const [account, setAccount] = useState<TradingAccount | null>(null)
  const [selected, setSelected] = useState(DEFAULT_TRADING_SYMBOL)
  const [names, setNames] = useState<Record<string, string | null>>({})
  const [realQuotes, setRealQuotes] = useState<Record<string, QuoteSnapshot>>({})
  const [setupDate, setSetupDate] = useState('')
  const [setupSpeed, setSetupSpeed] = useState<ReplaySpeedMs>(REPLAY_SPEEDS[1])
  const [side, setSide] = useState<TradeSide>('buy')
  const [tab, setTab] = useState<'positions' | 'trades'>('positions')
  const [notice, setNotice] = useState<TradeNotice | null>(null)
  // 移动端底部弹层（交易坞）展开态；桌面无交易坞，恒为收合（§3.11）
  const [panelOpen, setPanelOpen] = useState(false)
  const [info, setInfo] = useState<InfoSnapshot>(() => ({
    dataList: [],
    hovered: null,
    fundamental: {},
    intraday: false
  }))

  // 下单提交中（服务端权威成交期间防重复提交）
  const submittingRef = useRef(false)
  const namesTriedRef = useRef<Set<string>>(new Set())
  const feedRef = useRef<{ code: string | null; startDate: string | null; dayIndex: number }>({
    code: null,
    startDate: null,
    dayIndex: -1
  })
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const selectedCode = `${selected.market}${selected.ticker}`

  // 回放引擎：虚拟时钟（日原子）+ 各标的回放行情（选中 + 持仓按需拉取）
  const positionKey = useMemo(
    () =>
      (account?.positions ?? [])
        .map((p) => p.code)
        .sort()
        .join(','),
    [account]
  )
  const replayCodes = useMemo(
    () => [selectedCode, ...positionKey.split(',').filter(Boolean)],
    [selectedCode, positionKey]
  )
  const replay = useReplay({ anchorCode: selectedCode, codes: replayCodes, onAccountSync: setAccount })
  const simState = replay.state

  // 回放图表：注入式数据源（周期/指标/画线全功能复用），不拉实时行情
  const feed = useMemo(() => createReplayFeed(), [])
  const chart = useChartTerminal({
    containerRef: chartContainerRef,
    symbol: selected,
    enabled: account != null && replay.phase !== 'boot' && !replay.error,
    dataLoader: feed.loader,
    pollQuote: false,
    onInfoUpdate: setInfo
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(loadSelectedSymbol(REPLAY_SYMBOL_STORAGE_KEY) ?? DEFAULT_TRADING_SYMBOL)
  }, [])

  // setup 默认起始日：恒为当日——非交易日/当日 K 线未生成时由天数校验提示（可模拟 0 天、按钮禁用），不自动回退
  useEffect(() => {
    if (replay.phase === 'setup' && setupDate === '') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSetupDate(dayKeyOf(Date.now()))
    }
  }, [replay.phase, setupDate])

  // 标的名称：每标的一次性拉取（开局后回放行情展示用；未开局用实时行情自带名称）。
  // 注意：成功后才标记 tried——StrictMode 双挂载下首跑被取消，若先标记会永久跳过重试
  useEffect(() => {
    const missing = replayCodes.filter((code) => !namesTriedRef.current.has(code))
    if (missing.length === 0) {
      return
    }
    let cancelled = false
    void (async () => {
      const snapshots = await Promise.all(missing.map((code) => fetchQuoteSnapshot(code)))
      if (cancelled) {
        return
      }
      missing.forEach((code) => namesTriedRef.current.add(code))
      setNames((prev) => {
        const next = { ...prev }
        snapshots.forEach((snapshot, i) => {
          next[missing[i]!] = snapshot?.name ?? null
        })
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [replayCodes])

  // 未开局（setup）：真实行情轮询（与 /trade 一致）；点「开始模拟」后停止，切换为回放行情
  useEffect(() => {
    if (replay.phase !== 'setup') {
      return
    }
    const codes = Array.from(new Set([selectedCode, ...positionKey.split(',').filter(Boolean)]))
    if (codes.length === 0) {
      return
    }
    let cancelled = false
    const poll = async () => {
      const snapshots = await Promise.all(codes.map((code) => fetchQuoteSnapshot(code)))
      if (cancelled) {
        return
      }
      const next: Record<string, QuoteSnapshot> = {}
      snapshots.forEach((snapshot, i) => {
        if (snapshot != null) {
          next[codes[i]!] = snapshot
        }
      })
      if (Object.keys(next).length > 0) {
        setRealQuotes((prev) => ({ ...prev, ...next }))
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [replay.phase, selectedCode, positionKey])

  // 委托面板行情：setup = 实时行情（与 /trade 一致）；live = 回放行情
  // （现价 = 最新完成日收盘、昨收 = 回放前收，与图表一致，仅随虚拟日推进变化）
  const syntheticQuotes = useMemo(() => {
    if (replay.phase === 'setup') {
      return realQuotes
    }
    const map: Record<string, QuoteSnapshot> = {}
    for (const code of replayCodes) {
      const quote = replay.quoteOf(code)
      if (quote == null) {
        continue
      }
      map[code] = {
        market: code.slice(0, 2),
        ticker: code.slice(2),
        // 名称兜底：一次性拉取 → setup 阶段实时行情缓存 → 代码
        name: names[code] ?? realQuotes[code]?.name ?? code,
        price: quote.price,
        prevClose: quote.prevClose,
        fundamental: {}
      }
    }
    return map
  }, [replay, replayCodes, names, realQuotes])

  // 成交提示 3s 自动消隐
  useEffect(() => {
    if (notice == null) {
      return
    }
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  // 弹层展开时 Escape 收起
  useEffect(() => {
    if (!panelOpen) {
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanelOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen])

  // 图表喂数（setup）：实时完整日 K（含当日，与 /trade 一致）；
  // 随标的/数据到达重载；换起始日不影响（预览逻辑已取消，开局后才切回放图表）
  useEffect(() => {
    if (replay.phase !== 'setup' || replay.error) {
      return
    }
    const bars = replay.allBarsOf(selectedCode)
    if (bars.length === 0) {
      return
    }
    feed.setBars(selectedCode, bars)
    // 同 symbol setSymbol 也会 resetData 重载
    chart.setSymbol(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chart/feed/replay 方法逐渲染重建，入依赖会每帧重跑
  }, [replay.phase, replay.error, replay.barsVersion, selectedCode])

  // 图表喂数（live）：开局/换标的/恢复 → 全量替换 + 重载；逐日推进 → 增量推送当日 bar
  useEffect(() => {
    if (replay.phase !== 'live' || replay.error || simState == null) {
      return
    }
    const bars = replay.visibleBarsOf(selectedCode)
    if (bars.length === 0) {
      return
    }
    feed.setBars(selectedCode, bars)
    const prev = feedRef.current
    const incremental =
      prev.code === selectedCode && prev.startDate === simState.startDate && simState.dayIndex === prev.dayIndex + 1
    if (incremental) {
      feed.pushDay(selectedCode)
    } else {
      // 开局/换标的/恢复：同 symbol setSymbol 也会 resetData 全量重载
      chart.setSymbol(selected)
    }
    feedRef.current = { code: selectedCode, startDate: simState.startDate, dayIndex: simState.dayIndex }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chart/feed/replay 方法逐渲染重建，入依赖会每帧重跑
  }, [replay.phase, replay.error, replay.state, replay.barsVersion, selectedCode])

  // 展示层虚拟日结算（本地推导，不轮询）：本地时钟派生跨日时滚动 T+1 解冻与当日盈亏基准，
  // 价格取本地回放缓存（与服务端结算同一套纯函数）；账务权威仍在服务端——
  // 任何下单/会话操作的响应都会以服务端结算结果覆盖校准本地账户。
  // 账户 dayKey 晚于虚拟日（开局前按真实日期交易的仓位）视为历史持仓，全部解冻。
  useEffect(() => {
    if (replay.phase !== 'live' || simState == null || account == null) {
      return
    }
    const virtualDay = replay.calendar[simState.dayIndex - 1] ?? simState.startDate
    if (account.dayKey === virtualDay) {
      return
    }
    const rolled = account.dayKey > virtualDay ? releaseAllFrozen(account) : unfreezePositions(account, virtualDay)
    const { totalAssets } = calcEquity(rolled, priceMapOf(rolled, syntheticQuotes))
    // 跨日推导确需在 effect 内同步回写展示账户（与初始化 effect 同一豁免模式）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccount({ ...rolled, dayKey: virtualDay, dayStartEquity: totalAssets })
  }, [replay.phase, replay.calendar, simState, account, syntheticQuotes])

  const priceMap = useMemo(() => priceMapOf(account, syntheticQuotes), [account, syntheticQuotes])
  const equity = account != null ? calcEquity(account, priceMap) : null

  // 交易坞摘要（§3.11）：当前标的现价与涨跌（随行情阶段：实时 / 回放）
  const dockQuote = syntheticQuotes[selectedCode] ?? null
  const dockPrice = dockQuote?.price ?? null
  const dockChange =
    dockQuote != null && dockPrice != null && dockQuote.prevClose != null && dockQuote.prevClose > 0
      ? {
          abs: round2(dockPrice - dockQuote.prevClose),
          pct: ((dockPrice - dockQuote.prevClose) / dockQuote.prevClose) * 100
        }
      : null
  const dockClass = dockChange == null || dockChange.abs === 0 ? 'flat' : dockChange.abs > 0 ? 'up' : 'down'

  /** 下单：服务端权威校验与成交（涨跌停/整手/资金/T+1/虚拟时间戳均由 BFF 结算） */
  const handleSubmit = async (orderSide: TradeSide, price: number, qty: number) => {
    if (account == null || submittingRef.current) {
      return
    }
    const quote = syntheticQuotes[selectedCode]
    if (quote == null) {
      setNotice({ kind: 'err', text: t('行情加载中，请稍候|Quotes loading, please wait') })
      return
    }
    if (simState != null && simState.status !== 'running') {
      setNotice({
        kind: 'err',
        text:
          simState.status === 'ended'
            ? t('本局已结束，点「再来一局」重开|Session ended, press Play again to restart')
            : t('已暂停，点「继续」后才能下单|Paused, press Resume to trade')
      })
      return
    }
    submittingRef.current = true
    const result = await postSimOrder({
      side: orderSide,
      code: selectedCode,
      price,
      qty,
      name: quote.name ?? undefined
    })
    submittingRef.current = false
    if (result == null) {
      setNotice({ kind: 'err', text: t('网络异常，请稍候重试|Network error, please retry') })
      return
    }
    if (!result.ok) {
      setNotice({ kind: 'err', text: t(result.message) })
      return
    }
    replay.applySimState(result.state)
    setNotice({
      kind: 'ok',
      text: `${orderSide === 'buy' ? t('买入|Buy') : t('卖出|Sell')} ${selectedCode} ${qty}${t('股|shares')} @ ${price.toFixed(2)} ${t('已成交|filled')}`
    })
  }

  const handleStart = async () => {
    if (setupDate !== '') {
      const ok = await replay.start(setupDate, setupSpeed)
      if (!ok) {
        setNotice({ kind: 'err', text: t('开局失败，请稍候重试|Failed to start, please retry') })
      }
    }
  }

  const handleReset = async () => {
    if (
      !window.confirm(
        t(
          '确定重开一局？将清空全部持仓、记录与本局进度。|Restart the session? All positions, records and replay progress will be cleared.'
        )
      )
    ) {
      return
    }
    setSetupDate('')
    const ok = await replay.restart()
    if (!ok) {
      setNotice({ kind: 'err', text: t('重开失败，请稍候重试|Restart failed, please retry') })
      return
    }
    setNotice({ kind: 'ok', text: t('已重开一局|Session restarted') })
  }

  const setupForwardDays =
    replay.phase === 'setup' && setupDate !== '' ? replay.forwardCountOn(selectedCode, setupDate) : 0

  return (
    <div className={`trade-page${panelOpen ? ' sheet-open' : ''}`}>
      <div className="toolbar">
        <div className="toolbar-item">
          <Link className="tb-btn tb-clear" href="/dashboard">
            ← {t('返回行情|Back to chart')}
          </Link>
        </div>
        <ThemeToggle t={t} onToggle={chart.toggleTheme} id="theme-btn-top" itemClassName="theme-at-top" />
      </div>

      {replay.error ? (
        <div className="trade-loading">
          {t('回放数据加载失败|Failed to load replay data')}
          <button type="button" className="tb-btn sim-retry-btn" onClick={replay.retry}>
            {t('重试|Retry')}
          </button>
        </div>
      ) : account == null || equity == null || replay.phase === 'boot' ? (
        <div className="trade-loading">{t('加载中|Loading')}…</div>
      ) : (
        /* 单一滚动容器：工具栏固定，主区整体滚动（避免嵌套滚动导致面板内容被裁剪） */
        <div className="trade-scroll">
          <div className="trade-main">
            <section className="trade-card trade-chart">
              <div className="trade-chart-toolbar">
                {/* 返回行情（移动端，§3.11）：微信式左箭头图标按钮，与周期分段同行；
                    桌面隐藏，保留顶部工具栏文字链 */}
                <Link className="tb-btn tb-back" href="/dashboard" aria-label={t('返回行情|Back to chart')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
                {/* 精简周期组：仅日/周/月（周/月由日 K 本地聚合） */}
                <PeriodGroup simple activeKey={chart.periodKey} t={t} onChange={chart.changePeriod} />
                <div className="tb-divider" />
                {/* 移动端（§3.11）：强制换行——行 1 = 返回 + 周期 + 主题，行 2 = 功能按钮；桌面隐藏 */}
                <div className="tb-line-break" aria-hidden="true" />
                <ChartTools
                  t={t}
                  idPrefix="trade-"
                  mainIndicators={chart.mainIndicators}
                  subIndicators={chart.subIndicators}
                  onMainIndicatorChange={chart.toggleMainIndicator}
                  onSubIndicatorChange={chart.toggleSubIndicator}
                  activeTool={chart.activeTool}
                  onDrawingSelect={chart.selectDrawing}
                  onClearDrawings={chart.clearDrawings}
                />
                {/* 主题开关双位渲染：移动端并入图表工具栏（对齐首页），桌面隐藏于此（§3.11） */}
                <ThemeToggle t={t} onToggle={chart.toggleTheme} id="theme-btn-chart" itemClassName="theme-in-chart" />
              </div>
              <InfoTable info={info} locale={locale} />
              {/* klinecharts 画布容器（客户端初始化，不参与 SSR）：回放数据 */}
              <div className="trade-chart-body" ref={chartContainerRef} />
            </section>
            {/* 委托面板：桌面为右列单卡三段式（时钟 → 行情 → 交易 → 资产）；
               setup 阶段时钟条承载开局，委托表单以起始日前收盘预览（提交提示先开始）；
               移动端转悬浮交易坞（收合仅露坞条）+ 底部弹层（§3.11） */}
            <section
              id="trade-order-panel"
              className={`trade-card trade-panel${panelOpen ? ' open' : ''}`}
              role={panelOpen ? 'dialog' : undefined}
              aria-modal={panelOpen ? true : undefined}
              aria-label={t('委托交易|Order ticket')}
            >
              <button
                className="trade-dock-bar"
                type="button"
                aria-expanded={panelOpen}
                aria-controls="trade-order-panel"
                onClick={() => setPanelOpen((v) => !v)}
              >
                <svg
                  className="dock-chevron"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="dock-symbol">
                  <span className="dock-name">{dockQuote?.name ?? selectedCode}</span>
                  <span className="dock-code">{selectedCode}</span>
                </span>
                {dockPrice != null && (
                  <span className="dock-quote">
                    <span className={`dock-price ${dockClass}`}>{dockPrice.toFixed(2)}</span>
                    {dockChange != null && (
                      <span className={`dock-change ${dockClass}`}>
                        {dockChange.abs > 0 ? '+' : ''}
                        {dockChange.abs.toFixed(2)} ({dockChange.pct > 0 ? '+' : ''}
                        {dockChange.pct.toFixed(2)}%)
                      </span>
                    )}
                  </span>
                )}
              </button>
              <div className="trade-panel-body">
                <SimClockBar
                  t={t}
                  mode={replay.phase === 'setup' ? 'setup' : 'live'}
                  state={simState}
                  calendar={replay.calendar}
                  progress={replay.progress}
                  date={
                    replay.phase === 'setup'
                      ? setupDate
                      : simState != null
                        ? (replay.calendar[simState.dayIndex - 1] ?? simState.startDate)
                        : setupDate
                  }
                  range={replay.startRange}
                  forwardDays={setupForwardDays}
                  speedMs={replay.phase === 'setup' ? setupSpeed : (simState?.speedMs ?? setupSpeed)}
                  onDateChange={setSetupDate}
                  onStart={handleStart}
                  onToggle={replay.togglePause}
                  onSpeedChange={replay.phase === 'setup' ? setSetupSpeed : replay.setSpeed}
                />
                <OrderPanel
                  t={t}
                  side={side}
                  onSideChange={setSide}
                  code={selectedCode}
                  quote={syntheticQuotes[selectedCode] ?? null}
                  account={account}
                  onSubmit={handleSubmit}
                />
                <TradeSummary t={t} account={account} equity={equity} onReset={handleReset} />
              </div>
            </section>
            <section className="trade-card trade-records">
              {/* 移动端（§3.11）：滑块式分段（.tabs-thumb 平移），桌面为常规标签按钮 */}
              <div className={`trade-tabs${tab === 'trades' ? ' trades' : ''}`}>
                <span className="tabs-thumb" aria-hidden="true" />
                <button
                  className={`tb-btn${tab === 'positions' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setTab('positions')}
                >
                  {t('持仓|Positions')}({account.positions.length})
                </button>
                <button
                  className={`tb-btn${tab === 'trades' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setTab('trades')}
                >
                  {t('成交记录|Trades')}({account.trades.length})
                </button>
              </div>
              {tab === 'positions' ? (
                <PositionsTable t={t} positions={account.positions} quotes={syntheticQuotes} />
              ) : (
                <TradesTable t={t} trades={account.trades} locale={locale} />
              )}
            </section>
          </div>
        </div>
      )}

      {/* 本局结束：简版结算卡（数字汇总 + 再来一局） */}
      {simState?.status === 'ended' && equity != null && account != null && (
        <div className="sim-settle" role="dialog" aria-modal="true" aria-label={t('本局结算|Session summary')}>
          <div className="sim-settle-card">
            <h3 className="sim-settle-title">{t('本局结束|Session ended')}</h3>
            <div className="sim-settle-grid">
              <span className="sim-settle-cell">
                <span className="sim-settle-label">{t('总资产|Total assets')}</span>
                <span className="sim-settle-value num">{fmtMoney(equity.totalAssets)}</span>
              </span>
              <span className="sim-settle-cell">
                <span className="sim-settle-label">{t('总盈亏|Total P&L')}</span>
                <span className={`sim-settle-value num ${pnlClass(equity.totalPnl)}`}>
                  {fmtSignedMoney(equity.totalPnl)}
                </span>
              </span>
              <span className="sim-settle-cell">
                <span className="sim-settle-label">{t('总收益率|Return')}</span>
                <span className={`sim-settle-value num ${pnlClass(equity.totalPnl)}`}>
                  {fmtPct(equity.totalPnlPct)}
                </span>
              </span>
              <span className="sim-settle-cell">
                <span className="sim-settle-label">{t('成交笔数|Trades')}</span>
                <span className="sim-settle-value num">{account.trades.length}</span>
              </span>
            </div>
            <button type="button" className="sim-settle-btn" onClick={handleReset}>
              {t('再来一局|Play again')}
            </button>
          </div>
        </div>
      )}

      {/* 移动端弹层遮罩（桌面经 CSS 恒不显示） */}
      {panelOpen && <div className="trade-sheet-mask" aria-hidden="true" onClick={() => setPanelOpen(false)} />}

      {notice != null && (
        <div className={`trade-toast ${notice.kind}`} role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            {notice.kind === 'ok' ? (
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M7 7l10 10M17 7L7 17" strokeLinecap="round" />
            )}
          </svg>
          <span>{notice.text}</span>
        </div>
      )}
    </div>
  )
}

/** code -> 现价映射（持仓缺价回退成本价） */
const priceMapOf = (account: TradingAccount | null, quotes: Record<string, QuoteSnapshot>): Record<string, number> => {
  const map: Record<string, number> = {}
  for (const p of account?.positions ?? []) {
    const price = quotes[p.code]?.price
    if (price != null) {
      map[p.code] = round2(price)
    }
  }
  return map
}

const pnlClass = (n: number): string => (n > 0 ? 'up' : n < 0 ? 'down' : '')
