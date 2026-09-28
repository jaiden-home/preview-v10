'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KLineData } from 'klinecharts'
import { fetchDailyBars } from '@/lib/chart/api'
import {
  REPLAY_BAR_COUNT,
  advanceDay,
  calendarFrom,
  clearReplaySession,
  createReplaySession,
  forwardCountOf,
  loadReplaySession,
  replayQuoteOf,
  saveReplaySession,
  startRangeOf,
  visibleDailyBarsOf,
  type ReplayQuote,
  type ReplaySpeedMs,
  type ReplayStartRange,
  type ReplayState
} from '@/lib/trading/replay'

const DAY_MS = 86_400_000
/** 拉取跨度：约 640 根日 K 的自然日范围（含节假日；单次请求上限 640 根） */
const FETCH_SPAN_DAYS = Math.ceil(640 * 1.6)

/** boot = 引导中；setup = 选起始日开局；live = 模拟进行/暂停/结束 */
export type ReplayPhase = 'boot' | 'setup' | 'live'

export interface UseReplayOptions {
  /** 新局锚定标的（开局时的选中标的，提供共享交易日历） */
  anchorCode: string
  /** 需要回放行情的标的（选中 + 持仓），按需拉取并内存缓存 */
  codes: string[]
}

export interface UseReplayResult {
  phase: ReplayPhase
  /** 引导失败（数据源不可用），提示重试 */
  error: boolean
  state: ReplayState | null
  calendar: string[]
  /** setup 阶段：可选起始日范围 */
  startRange: ReplayStartRange | null
  /** 当前日计时进度 0..1（running 时；暂停/结束为 0） */
  progress: number
  /** bars 缓存版本号（任一标的拉取完成后 +1，驱动依赖方重算） */
  barsVersion: number
  /** 当前市场态（最新完成日收盘 + 前收） */
  quoteOf: (code: string) => ReplayQuote | null
  /** 图表可见日 K（起始日前历史 + 已完成模拟日） */
  visibleBarsOf: (code: string) => KLineData[]
  /** 全量日 K（未开局阶段图表展示实时完整 K 线，与 /trade 一致） */
  allBarsOf: (code: string) => KLineData[]
  /** setup 预览：自某日期起可模拟的交易日数 */
  forwardCountOn: (code: string, date: string) => number
  /** 开局：第 1 个交易日立即完成（speedMs 为 setup 阶段所选倍速） */
  start: (startDate: string, speedMs?: ReplaySpeedMs) => void
  togglePause: () => void
  setSpeed: (ms: ReplaySpeedMs) => void
  /** 重开一局（清会话，回到选日期） */
  restart: () => void
  /** 引导失败后重试 */
  retry: () => void
}

/**
 * 虚拟时钟钩子（日原子模型）：running 时每过 speedMs 完成一个交易日（advanceDay），
 * 账户的跨日结算（T+1 解冻 / 当日盈亏滚动）由页面在 dayIndex 变化时执行。
 * 恢复一律暂停态；setup 阶段引擎只提供起始日范围与可模拟天数
 * （图表/委托面板由页面直接走实时行情，与 /trade 一致）。
 */
export const useReplay = (options: UseReplayOptions): UseReplayResult => {
  const { anchorCode, codes } = options

  const [phase, setPhase] = useState<ReplayPhase>('boot')
  const [state, setState] = useState<ReplayState | null>(null)
  const [calendar, setCalendar] = useState<string[]>([])
  const [startRange, setStartRange] = useState<ReplayStartRange | null>(null)
  const [error, setError] = useState(false)
  const [barsVersion, setBarsVersion] = useState(0)
  const [bootId, setBootId] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [dayStartedAt, setDayStartedAt] = useState(0)

  const barsRef = useRef<Map<string, KLineData[]>>(new Map())
  const pendingRef = useRef<Set<string>>(new Set())
  const anchorRef = useRef(anchorCode)

  // 引导在 effect 中读取锚定标的（新局用开局时的选中标的）
  useEffect(() => {
    anchorRef.current = anchorCode
  }, [anchorCode])

  // 引导：恢复会话（按 startDate 重算日历）或进入 setup 选日期；失败可重试（bootId）
  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      setPhase('boot')
      setError(false)
      setState(null)
      setCalendar([])
      setStartRange(null)
      barsRef.current = new Map()
      pendingRef.current.clear()
      const session = loadReplaySession()
      const anchor = session?.anchorCode ?? anchorRef.current
      const bars = await fetchDailyBars(anchor, Date.now() - FETCH_SPAN_DAYS * DAY_MS, Date.now())
      if (cancelled) {
        return
      }
      if (bars.length < 3) {
        setError(true)
        return
      }
      barsRef.current = new Map([[anchor, bars]])
      setBarsVersion((v) => v + 1)
      if (session != null) {
        const cal = calendarFrom(bars, session.startDate)
        if (cal.length > 0) {
          // 恢复一律暂停（ended 保持结束态）；历史覆盖不足时按实际天数封顶
          const next: ReplayState =
            session.status === 'ended'
              ? session
              : { ...session, status: 'paused', dayCount: Math.min(session.dayCount, cal.length) }
          setCalendar(cal)
          setState(next)
          setPhase('live')
          return
        }
        // 恢复失效（历史窗口不再覆盖），落回 setup
      }
      setStartRange(startRangeOf(bars))
      setPhase('setup')
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [bootId])

  const codesKey = Array.from(new Set(codes)).sort().join(',')

  // 按需拉取：选中/持仓标的与锚定同跨度全量日 K（失败缓存空数组，重进页面再试）
  useEffect(() => {
    if (phase === 'boot' || error || codesKey.length === 0) {
      return
    }
    let cancelled = false
    const missing = codesKey
      .split(',')
      .filter((code) => code.length > 0 && !barsRef.current.has(code) && !pendingRef.current.has(code))
    if (missing.length === 0) {
      return
    }
    missing.forEach((code) => pendingRef.current.add(code))
    void (async () => {
      const results = await Promise.all(
        missing.map((code) => fetchDailyBars(code, Date.now() - FETCH_SPAN_DAYS * DAY_MS, Date.now()))
      )
      if (cancelled) {
        return
      }
      results.forEach((bars, i) => {
        barsRef.current.set(missing[i]!, bars)
      })
      setBarsVersion((v) => v + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [phase, error, codesKey])

  // 虚拟时钟：running 时每过 speedMs 完成一个交易日（dayStartedAt 供进度条换算）
  useEffect(() => {
    if (phase !== 'live' || state?.status !== 'running') {
      return
    }
    const speedMs = state.speedMs
    const timer = setInterval(() => {
      setDayStartedAt(Date.now())
      setState((prev) => (prev == null ? prev : advanceDay(prev)))
    }, speedMs)
    return () => clearInterval(timer)
  }, [phase, state?.status, state?.speedMs])

  // 进度条刷新（1s 一拍，仅 running）
  useEffect(() => {
    if (phase !== 'live' || state?.status !== 'running') {
      return
    }
    const timer = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [phase, state?.status])

  // 会话状态持久化
  useEffect(() => {
    if (state != null) {
      saveReplaySession(state)
    }
  }, [state])

  const dayIndex = state?.dayIndex ?? 0

  const quoteOf = (code: string): ReplayQuote | null => {
    const bars = barsRef.current.get(code)
    if (bars == null || calendar.length === 0) {
      return null
    }
    return replayQuoteOf(bars, dayIndex, calendar)
  }

  const visibleBarsOf = (code: string): KLineData[] => {
    const bars = barsRef.current.get(code)
    if (bars == null || calendar.length === 0) {
      return []
    }
    return visibleDailyBarsOf(bars, dayIndex, calendar)
  }

  const allBarsOf = (code: string): KLineData[] => barsRef.current.get(code) ?? []

  const forwardCountOn = (code: string, date: string): number => forwardCountOf(barsRef.current.get(code) ?? [], date)

  const start = useCallback((startDate: string, speedMs?: ReplaySpeedMs) => {
    const bars = barsRef.current.get(anchorRef.current)
    if (bars == null) {
      return
    }
    const cal = calendarFrom(bars, startDate)
    // 至少 2 个交易日（大于 1 日）才能开局（按钮层已拦截，此处兜底）
    if (cal.length < 2) {
      return
    }
    setDayStartedAt(Date.now())
    setCalendar(cal)
    setState(createReplaySession(anchorRef.current, startDate, Math.min(REPLAY_BAR_COUNT, cal.length), speedMs))
    setPhase('live')
  }, [])

  const togglePause = useCallback(() => {
    if (state == null || state.status === 'ended') {
      return
    }
    if (state.status === 'paused') {
      // 继续后当前日重新计时满档
      setDayStartedAt(Date.now())
    }
    setState({ ...state, status: state.status === 'running' ? 'paused' : 'running' })
  }, [state])

  const setSpeed = useCallback(
    (ms: ReplaySpeedMs) => {
      if (state == null || state.speedMs === ms) {
        return
      }
      setDayStartedAt(Date.now())
      setState({ ...state, speedMs: ms })
    },
    [state]
  )

  const restart = useCallback(() => {
    clearReplaySession()
    barsRef.current.clear()
    pendingRef.current.clear()
    setBootId((id) => id + 1)
  }, [])

  const retry = useCallback(() => {
    setBootId((id) => id + 1)
  }, [])

  const progress = state?.status === 'running' ? Math.min(1, Math.max(0, (nowTick - dayStartedAt) / state.speedMs)) : 0

  return {
    phase,
    error,
    state,
    calendar,
    startRange,
    progress,
    barsVersion,
    quoteOf,
    visibleBarsOf,
    allBarsOf,
    forwardCountOn,
    start,
    togglePause,
    setSpeed,
    restart,
    retry
  }
}
