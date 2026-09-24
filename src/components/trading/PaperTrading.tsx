'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import PeriodGroup from '@/components/terminal/PeriodGroup'
import ChartTools from '@/components/terminal/ChartTools'
import InfoTable from '@/components/terminal/InfoTable'
import { useLocale } from '@/components/terminal/useLocale'
import { useChartTerminal } from '@/components/terminal/useChartTerminal'
import { POLL_INTERVAL_MS } from '@/lib/chart/constants'
import type { InfoSnapshot } from '@/lib/chart/terminal'
import { fetchQuoteSnapshot } from '@/lib/chart/api'
import type { QuoteSnapshot } from '@/lib/chart/types'
import OrderPanel from './OrderPanel'
import PositionsTable from './PositionsTable'
import TradesTable from './TradesTable'
import TradeSummary from './TradeSummary'
import {
  calcEquity,
  createInitialAccount,
  dayKeyOf,
  executeBuy,
  executeSell,
  loadAccount,
  loadSelectedSymbol,
  round2,
  saveAccount,
  unfreezePositions,
  validateOrder,
  type TradeSide,
  type TradingAccount
} from '@/lib/trading/account'

/** 模拟交易默认标的（首页默认为上证指数，不可交易） */
const DEFAULT_TRADING_SYMBOL = { market: 'sh', ticker: '600519' }

interface TradeNotice {
  kind: 'ok' | 'err'
  text: string
}

/**
 * 模拟交易页：本地虚拟账户（localStorage 持久化）+ BFF 行情 3s 轮询。
 * A 股语义：整手买入、T+1 卖出、涨跌停校验、佣金/印花税/过户费。
 * 行情图表复用 ChartTerminal（分时/多周期 K 线 + 指标），与交易标的双向同步；
 * 图表生命周期与控件状态由 useChartTerminal 统一封装。
 */
export default function PaperTrading() {
  const { locale, t } = useLocale()

  const [account, setAccount] = useState<TradingAccount | null>(null)
  const [selected, setSelected] = useState(DEFAULT_TRADING_SYMBOL)
  const [quotes, setQuotes] = useState<Record<string, QuoteSnapshot>>({})
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

  const accountRef = useRef<TradingAccount | null>(null)
  const quotesRef = useRef<Record<string, QuoteSnapshot>>({})
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const selectedCode = `${selected.market}${selected.ticker}`

  // 行情图表：账户就绪（DOM 渲染）后初始化（默认日 K），标的切换由钩子自动同步
  const chart = useChartTerminal({
    containerRef: chartContainerRef,
    symbol: selected,
    enabled: account != null,
    onInfoUpdate: setInfo
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccount(loadAccount() ?? createInitialAccount())
    setSelected(loadSelectedSymbol() ?? DEFAULT_TRADING_SYMBOL)
  }, [])

  // refs 供轮询闭包读取最新值
  useEffect(() => {
    accountRef.current = account
  }, [account])
  useEffect(() => {
    quotesRef.current = quotes
  }, [quotes])

  // 账户变更即持久化
  useEffect(() => {
    if (account != null) {
      saveAccount(account)
    }
  }, [account])

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

  const positionKey = useMemo(
    () =>
      (account?.positions ?? [])
        .map((p) => p.code)
        .sort()
        .join(','),
    [account]
  )

  // 行情轮询：当前标的 + 持仓标的，3s 一次（与终端一致）；跨交易日滚动当日盈亏基准
  useEffect(() => {
    const codes = Array.from(new Set([selectedCode, ...positionKey.split(',').filter(Boolean)]))
    if (codes.length === 0) {
      return
    }
    let cancelled = false
    const tick = async () => {
      const snapshots = await Promise.all(codes.map((code) => fetchQuoteSnapshot(code)))
      if (cancelled) {
        return
      }
      const next: Record<string, QuoteSnapshot> = {}
      snapshots.forEach((snapshot, i) => {
        if (snapshot != null) {
          next[codes[i]] = snapshot
        }
      })
      if (Object.keys(next).length === 0) {
        return
      }
      quotesRef.current = { ...quotesRef.current, ...next }
      setQuotes((prev) => ({ ...prev, ...next }))

      const acc = accountRef.current
      const today = dayKeyOf(Date.now())
      if (acc != null && acc.dayKey !== today) {
        const rolled = unfreezePositions(acc, today)
        const { totalAssets } = calcEquity(rolled, priceMapOf(rolled, quotesRef.current))
        setAccount({ ...rolled, dayKey: today, dayStartEquity: totalAssets })
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [selectedCode, positionKey])

  const priceMap = useMemo(() => priceMapOf(account, quotes), [account, quotes])
  const equity = account != null ? calcEquity(account, priceMap) : null

  // 交易坞摘要（§3.11）：当前标的现价与涨跌
  const dockQuote = quotes[selectedCode] ?? null
  const dockPrice = dockQuote?.price ?? null
  const dockChange =
    dockQuote != null && dockPrice != null && dockQuote.prevClose != null && dockQuote.prevClose > 0
      ? {
          abs: round2(dockPrice - dockQuote.prevClose),
          pct: ((dockPrice - dockQuote.prevClose) / dockQuote.prevClose) * 100
        }
      : null
  const dockClass = dockChange == null || dockChange.abs === 0 ? 'flat' : dockChange.abs > 0 ? 'up' : 'down'

  const handleSubmit = (orderSide: TradeSide, price: number, qty: number) => {
    if (account == null) {
      return
    }
    const quote = quotes[selectedCode]
    const name = quote?.name ?? selectedCode
    const error = validateOrder({
      account,
      side: orderSide,
      code: selectedCode,
      price,
      qty,
      prevClose: quote?.prevClose ?? null
    })
    if (error != null) {
      setNotice({ kind: 'err', text: t(error) })
      return
    }
    const order = { code: selectedCode, name, price, qty, ts: Date.now() }
    setAccount(orderSide === 'buy' ? executeBuy(account, order) : executeSell(account, order))
    setNotice({
      kind: 'ok',
      text: `${orderSide === 'buy' ? t('买入|Buy') : t('卖出|Sell')} ${selectedCode} ${qty}${t('股|shares')} @ ${price.toFixed(2)} ${t('已成交|filled')}`
    })
  }

  const handleReset = () => {
    if (
      !window.confirm(
        t(
          '确定重置模拟账户？将清空全部持仓与记录。|Reset the paper account? All positions and records will be cleared.'
        )
      )
    ) {
      return
    }
    setAccount(createInitialAccount())
    setNotice({ kind: 'ok', text: t('账户已重置|Account reset') })
  }

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

      {account == null || equity == null ? (
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
                {/* 精简周期组：仅日/周/月 */}
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
              {/* klinecharts 画布容器（客户端初始化，不参与 SSR） */}
              <div className="trade-chart-body" ref={chartContainerRef} />
            </section>
            {/* 委托面板：桌面为右列单卡三段式（行情 → 交易 → 资产）；
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
                <OrderPanel
                  t={t}
                  side={side}
                  onSideChange={setSide}
                  code={selectedCode}
                  quote={quotes[selectedCode] ?? null}
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
                <PositionsTable t={t} positions={account.positions} quotes={quotes} />
              ) : (
                <TradesTable t={t} trades={account.trades} locale={locale} />
              )}
            </section>
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
