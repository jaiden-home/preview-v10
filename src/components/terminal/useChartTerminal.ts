'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { KLineData } from 'klinecharts'
import { ChartTerminal, type InfoSnapshot } from '@/lib/chart/terminal'
import { DEFAULT_PERIOD_KEY, type PeriodKey } from '@/lib/chart/constants'
import type { QuoteSnapshot } from '@/lib/chart/types'
import { readLocaleFromHash } from '@/lib/i18n'

/** 当前是否深色主题：#app.dark 类是唯一事实源（客户端导航不重建根节点，主题类随 DOM 保留到下一页面） */
const readAppDark = (): boolean =>
  typeof document !== 'undefined' && (document.getElementById('app')?.classList.contains('dark') ?? false)

interface UseChartTerminalOptions {
  /** 图表挂载容器（由调用方创建并绑定到 DOM） */
  containerRef: RefObject<HTMLDivElement | null>
  symbol: { market: string; ticker: string }
  /** 服务端直出的首屏 K 线与行情（null 表示上游超时/失败，客户端补拉） */
  initialBars?: KLineData[] | null
  initialQuote?: QuoteSnapshot | null
  /** 图表挂载前置条件（交易页需等待账户就绪后才渲染容器），默认 true */
  enabled?: boolean
  onInfoUpdate?: (info: InfoSnapshot) => void
  onQuoteArrived?: (quote: QuoteSnapshot) => void
}

/**
 * 图表终端交互钩子（行情页与交易页共用）：
 * 封装 ChartTerminal 生命周期（创建/销毁/换标的/主题）与周期、指标、绘图控件状态。
 * 终端随挂载条件整体重建，创建参数取启用时刻的快照；此后 symbol 变更走 setSymbol 增量同步。
 * 返回值不含 ref（ref 污染会触发 react-hooks/refs 规则），终端邻接能力以方法形式暴露。
 */
export function useChartTerminal(options: UseChartTerminalOptions) {
  const { containerRef } = options
  const terminalRef = useRef<ChartTerminal | null>(null)
  /** 当前图表已加载的标的（与同步 effect、setSymbol 共同维护，避免重复切换） */
  const chartSymbolRef = useRef<string | null>(null)

  const [periodKey, setPeriodKey] = useState<PeriodKey>(DEFAULT_PERIOD_KEY)
  const [mainIndicators, setMainIndicators] = useState<ReadonlySet<string>>(() => new Set(['MA']))
  const [subIndicators, setSubIndicators] = useState<ReadonlySet<string>>(() => new Set(['VOL', 'MACD']))
  const [activeTool, setActiveTool] = useState<string | null>(null)

  const enabled = options.enabled !== false
  const symbolKey = `${options.symbol.market}${options.symbol.ticker}`
  // 创建参数取启用时刻的快照（挂载快照语义，与原页面内联实现一致）；
  // 在 effect 中同步（声明于创建 effect 之前，保证创建时读到当次渲染值）
  const latestOptions = useRef(options)
  useEffect(() => {
    latestOptions.current = options
  })

  useEffect(() => {
    if (!enabled) {
      return
    }
    const container = containerRef.current
    if (container == null) {
      return
    }
    const { symbol, initialBars, initialQuote, onInfoUpdate, onQuoteArrived } = latestOptions.current
    const terminal = new ChartTerminal({
      container,
      symbol,
      initialBars: initialBars ?? null,
      initialQuote: initialQuote ?? null,
      dark: readAppDark(),
      locale: readLocaleFromHash(),
      onInfoUpdate: onInfoUpdate ?? (() => {}),
      onQuoteArrived,
      onDrawingEnd: () => setActiveTool(null)
    })
    terminalRef.current = terminal
    chartSymbolRef.current = `${symbol.market}${symbol.ticker}`
    void terminal.init()
    // klinecharts 不自动跟随容器伸缩：容器盒尺寸变化（交易页首行随面板内容变化）时重算画布布局
    const resizeObserver = new ResizeObserver(() => terminal.resize())
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      terminal.destroy()
      terminalRef.current = null
      chartSymbolRef.current = null
    }
    // 仅随挂载条件创建/销毁，其余依赖以 ref 快照读取
  }, [enabled, containerRef])

  // 标的变化 → 图表同步（选股 / 持仓表买卖切换 / 路由参数变化）
  useEffect(() => {
    if (chartSymbolRef.current === symbolKey) {
      return
    }
    chartSymbolRef.current = symbolKey
    terminalRef.current?.setSymbol(latestOptions.current.symbol)
  }, [symbolKey])

  /** 页面内直接切标的（同步 ref，避免触发上方 effect 重复调用） */
  const setSymbol = (symbol: { market: string; ticker: string }) => {
    chartSymbolRef.current = `${symbol.market}${symbol.ticker}`
    terminalRef.current?.setSymbol(symbol)
  }

  const toggleTheme = () => {
    // 每次从 DOM 取反（而非本地 state）：跨页客户端导航后本组件重建，state 会失真
    const root = document.getElementById('app')
    const next = !readAppDark()
    // 切换瞬间抑制 CSS 过渡：避免元素对变量换值做 0.2s 补间（按钮底色闪烁）
    root?.classList.add('theme-switching')
    // dark 类挂在应用根节点上，与 #app 命名空间的 CSS 配套
    root?.classList.toggle('dark', next)
    terminalRef.current?.setTheme(next)
    window.setTimeout(() => root?.classList.remove('theme-switching'), 50)
  }

  const changePeriod = (key: PeriodKey) => {
    if (key === periodKey) {
      return
    }
    setPeriodKey(key)
    terminalRef.current?.applyPeriodKey(key)
  }

  const toggleMainIndicator = (name: string, checked: boolean) => {
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

  const toggleSubIndicator = (name: string, checked: boolean) => {
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

  const selectDrawing = (name: string) => {
    setActiveTool((prev) => (prev === name ? null : name))
    terminalRef.current?.startDrawing(name)
  }

  const clearDrawings = () => {
    setActiveTool(null)
    terminalRef.current?.clearDrawings()
  }

  /** 指标参数弹窗等终端邻接能力 */
  const getIndicatorSnapshot = () => terminalRef.current?.getIndicatorSnapshot() ?? []
  const overrideIndicatorParams = (paneId: string, name: string, calcParams: number[]) => {
    terminalRef.current?.overrideIndicatorParams(paneId, name, calcParams)
  }

  return {
    setSymbol,
    toggleTheme,
    periodKey,
    changePeriod,
    mainIndicators,
    subIndicators,
    toggleMainIndicator,
    toggleSubIndicator,
    activeTool,
    selectDrawing,
    clearDrawings,
    getIndicatorSnapshot,
    overrideIndicatorParams
  }
}
