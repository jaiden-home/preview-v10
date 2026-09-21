'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import IndicatorMenu from '@/components/terminal/IndicatorMenu'
import DrawingMenu from '@/components/terminal/DrawingMenu'
import InfoTable from '@/components/terminal/InfoTable'
import { MAIN_INDICATORS, POLL_INTERVAL_MS, SUB_INDICATORS, type PeriodKey } from '@/lib/chart/constants'
import { ChartTerminal, type InfoSnapshot } from '@/lib/chart/terminal'
import { fetchQuoteSnapshot } from '@/lib/chart/api'
import { parseSymbolCode, type QuoteSnapshot } from '@/lib/chart/types'
import { createT, readLocaleFromHash, type Locale } from '@/lib/i18n'
import OrderPanel from './OrderPanel'
import PositionsTable from './PositionsTable'
import TradesTable from './TradesTable'
import {
  calcEquity,
  createInitialAccount,
  dayKeyOf,
  executeBuy,
  executeSell,
  fmtMoney,
  fmtPct,
  fmtSignedMoney,
  loadAccount,
  loadSelectedSymbol,
  round2,
  saveAccount,
  saveSelectedSymbol,
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
 * 行情图表复用 ChartTerminal（分时/多周期 K 线 + 指标），与交易标的双向同步。
 */
export default function PaperTrading() {
  // SSR 首帧固定 zh-CN（避免水合不匹配），挂载后按 #en-US hash 校正
  const [locale, setLocale] = useState<Locale>('zh-CN')
  const t = useMemo(() => createT(locale), [locale])
  const [dark, setDark] = useState(false)

  const [account, setAccount] = useState<TradingAccount | null>(null)
  const [selected, setSelected] = useState(DEFAULT_TRADING_SYMBOL)
  const [quotes, setQuotes] = useState<Record<string, QuoteSnapshot>>({})
  const [side, setSide] = useState<TradeSide>('buy')
  const [tab, setTab] = useState<'positions' | 'trades'>('positions')
  const [notice, setNotice] = useState<TradeNotice | null>(null)
  // 图表默认日 K（与行情页一致），工具栏/指标/绘图同款
  const [chartPeriod, setChartPeriod] = useState<PeriodKey>('1d')
  const [mainIndicators, setMainIndicators] = useState<ReadonlySet<string>>(() => new Set(['MA']))
  const [subIndicators, setSubIndicators] = useState<ReadonlySet<string>>(() => new Set(['VOL', 'MACD']))
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [info, setInfo] = useState<InfoSnapshot>(() => ({
    dataList: [],
    hovered: null,
    fundamental: {},
    intraday: false
  }))

  const accountRef = useRef<TradingAccount | null>(null)
  const quotesRef = useRef<Record<string, QuoteSnapshot>>({})
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<ChartTerminal | null>(null)
  const chartSymbolRef = useRef<string | null>(null)
  const selectedCode = `${selected.market}${selected.ticker}`

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocale(readLocaleFromHash())
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

  // 行情图表：账户就绪（DOM 渲染）后初始化（默认日 K），随路由卸载销毁
  const chartReady = account != null
  useEffect(() => {
    if (!chartReady) {
      return
    }
    const container = chartContainerRef.current
    if (container == null) {
      return
    }
    const terminal = new ChartTerminal({
      container,
      symbol: { market: selected.market, ticker: selected.ticker },
      initialBars: null,
      initialQuote: null,
      locale: readLocaleFromHash(),
      onInfoUpdate: setInfo,
      onDrawingEnd: () => setActiveTool(null)
    })
    terminalRef.current = terminal
    chartSymbolRef.current = selectedCode
    void terminal.init()
    return () => {
      terminal.destroy()
      terminalRef.current = null
      chartSymbolRef.current = null
    }
    // 仅在首次就绪时创建；标的切换由下方同步 effect 处理（挂载快照）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartReady])

  // 交易标的 → 图表同步（选股 / 持仓表买买卖切换）
  useEffect(() => {
    if (chartSymbolRef.current === selectedCode) {
      return
    }
    chartSymbolRef.current = selectedCode
    terminalRef.current?.setSymbol(selected)
  }, [selectedCode, selected])

  // 成交提示 3s 自动消隐
  useEffect(() => {
    if (notice == null) {
      return
    }
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])

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

  const handlePositionTrade = (code: string, tradeSide: TradeSide) => {
    const parsed = parseSymbolCode(code)
    if (parsed == null) {
      return
    }
    setSelected({ market: parsed.market, ticker: parsed.ticker })
    saveSelectedSymbol({ market: parsed.market, ticker: parsed.ticker })
    setSide(tradeSide)
  }

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

  const handleThemeToggle = () => {
    const next = !dark
    setDark(next)
    document.getElementById('app')?.classList.toggle('dark', next)
    terminalRef.current?.setTheme(next)
  }

  const handleChartPeriodChange = (key: PeriodKey) => {
    if (key === chartPeriod) {
      return
    }
    setChartPeriod(key)
    terminalRef.current?.applyPeriodKey(key)
  }

  const handleMainIndicatorChange = (name: string, checked: boolean) => {
    setMainIndicators((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(name)
      } else {
        next.delete(name)
      }
      return next
    })
    terminalRef.current?.toggleMainIndicator(name, checked)
  }

  const handleSubIndicatorChange = (name: string, checked: boolean) => {
    setSubIndicators((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(name)
      } else {
        next.delete(name)
      }
      return next
    })
    terminalRef.current?.toggleSubIndicator(name, checked)
  }

  const handleDrawingSelect = (name: string) => {
    setActiveTool((prev) => (prev === name ? null : name))
    terminalRef.current?.startDrawing(name)
  }

  const pnlClass = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat')

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-item">
          <a className="tb-btn tb-clear" href={`/${selectedCode}`}>
            ← {t('返回行情|Back to chart')}
          </a>
        </div>
        <ThemeToggle t={t} onToggle={handleThemeToggle} />
      </div>

      {account == null || equity == null ? (
        <div className="trade-loading">{t('加载中|Loading')}…</div>
      ) : (
        <>
          <div className="trade-summary">
            <div className="stat-cell">
              <span className="stat-label">{t('总资产|Total assets')}</span>
              <span className="stat-value">{fmtMoney(equity.totalAssets)}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">{t('当日盈亏|Day P&L')}</span>
              <span className={`stat-value ${pnlClass(equity.dayPnl)}`}>{fmtSignedMoney(equity.dayPnl)}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">{t('总盈亏|Total P&L')}</span>
              <span className={`stat-value ${pnlClass(equity.totalPnl)}`}>
                {fmtSignedMoney(equity.totalPnl)}（{fmtPct(equity.totalPnlPct)}）
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">{t('可用资金|Cash')}</span>
              <span className="stat-value">{fmtMoney(account.cash)}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">{t('持仓市值|Market value')}</span>
              <span className="stat-value">{fmtMoney(equity.marketValue)}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">{t('持仓盈亏|Position P&L')}</span>
              <span className={`stat-value ${pnlClass(equity.positionPnl)}`}>{fmtSignedMoney(equity.positionPnl)}</span>
            </div>
            <div className="stat-reset">
              <span className="stat-label">
                {t('初始资金|Initial capital')} {fmtMoney(account.initialCapital)}
              </span>
              <button className="tb-btn tb-clear" type="button" onClick={handleReset}>
                {t('重置账户|Reset')}
              </button>
            </div>
          </div>

          <div className="trade-main">
            <section className="trade-card trade-chart">
              <div className="trade-chart-toolbar">
                {/* 精简周期组：仅日/周/月（不引 PeriodGroup，避免改动行情页共享组件） */}
                <div className="toolbar-item period-group">
                  {(
                    [
                      { key: '1d', text: t('日|1D') },
                      { key: '1w', text: t('周|1W') },
                      { key: '1M', text: t('月|1M') }
                    ] as Array<{ key: PeriodKey; text: string }>
                  ).map((option) => (
                    <button
                      key={option.key}
                      className={`tb-btn period-btn${chartPeriod === option.key ? ' active' : ''}`}
                      type="button"
                      onClick={() => handleChartPeriodChange(option.key)}
                    >
                      {option.text}
                    </button>
                  ))}
                </div>
                <div className="tb-divider" />
                <IndicatorMenu
                  buttonId="trade-main-indicator-btn"
                  dropdownId="trade-main-indicator-dropdown"
                  label={t('主图指标|Main Indicators')}
                  names={MAIN_INDICATORS}
                  selected={mainIndicators}
                  onChange={handleMainIndicatorChange}
                />
                <IndicatorMenu
                  buttonId="trade-sub-indicator-btn"
                  dropdownId="trade-sub-indicator-dropdown"
                  label={t('副图指标|Sub Indicators')}
                  names={SUB_INDICATORS}
                  selected={subIndicators}
                  onChange={handleSubIndicatorChange}
                />
                <DrawingMenu activeTool={activeTool} t={t} onSelect={handleDrawingSelect} />
                <div className="toolbar-item">
                  <button
                    className="tb-btn tb-clear"
                    id="trade-clear-btn"
                    type="button"
                    onClick={() => {
                      setActiveTool(null)
                      terminalRef.current?.clearDrawings()
                    }}
                  >
                    {t('清除绘图|Clear Drawings')}
                  </button>
                </div>
              </div>
              <InfoTable info={info} locale={locale} />
              {/* klinecharts 画布容器（客户端初始化，不参与 SSR） */}
              <div className="trade-chart-body" ref={chartContainerRef} />
            </section>
            <OrderPanel
              t={t}
              side={side}
              onSideChange={setSide}
              code={selectedCode}
              quote={quotes[selectedCode] ?? null}
              account={account}
              onSubmit={handleSubmit}
            />
            <section className="trade-card trade-right">
              <div className="trade-tabs">
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
                <PositionsTable t={t} positions={account.positions} quotes={quotes} onTrade={handlePositionTrade} />
              ) : (
                <TradesTable t={t} trades={account.trades} locale={locale} />
              )}
            </section>
          </div>
        </>
      )}

      {notice != null && <div className={`trade-toast ${notice.kind}`}>{notice.text}</div>}
    </>
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
