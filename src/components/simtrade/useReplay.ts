'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KLineData } from 'klinecharts'
import { fetchReplayBars } from '@/lib/chart/api'
import type { TradingAccount } from '@/lib/trading/account'
import type { SimSession, SimState } from '@/lib/trading/protocol'
import {
  REPLAY_SPEEDS,
  calendarFrom,
  forwardCountOf,
  replayQuoteOf,
  startRangeOf,
  visibleDailyBarsOf,
  type ReplayQuote,
  type ReplaySpeedMs,
  type ReplayStartRange
} from '@/lib/trading/replay'
import { fetchSimState, postSimSession } from '@/lib/trading/sim-api'

/** 回放数据集：向 BFF 拉取全量历史日 K（按页回溯至上市/数据尽头，上限 5000 根 ≈ 20 年）；
 *  起始日任意可选，可模拟天数由数据决定（与服务端结算口径一致） */
const REPLAY_FETCH_BARS = 5000

/** live running 时的服务端状态轮询间隔（进度条本地插值，轮询仅做权威校准） */
const SIM_POLL_INTERVAL_MS = 1_000

/** boot = 引导中；setup = 选起始日开局；live = 模拟进行/暂停/结束 */
export type ReplayPhase = 'boot' | 'setup' | 'live'

export interface UseReplayOptions {
  /** 新局锚定标的（开局时的选中标的，提供共享交易日历） */
  anchorCode: string
  /** 需要回放行情的标的（选中 + 持仓），按需拉取并内存缓存 */
  codes: string[]
  /** 服务端权威账户同步（boot/轮询/会话操作后回调） */
  onAccountSync?: (account: TradingAccount) => void
}

export interface UseReplayResult {
  phase: ReplayPhase
  /** 引导失败（状态或数据源不可用），提示重试 */
  error: boolean
  state: SimSession | null
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
  /** 开局（服务端建立会话）；返回是否成功 */
  start: (startDate: string, speedMs?: ReplaySpeedMs) => Promise<boolean>
  togglePause: () => void
  setSpeed: (ms: ReplaySpeedMs) => void
  /** 重开一局（服务端清会话与账户，回到选日期）；返回是否成功 */
  restart: () => Promise<boolean>
  /** 引导失败后重试 */
  retry: () => void
  /** 下单响应等即时同步服务端权威状态（账户由调用方处理） */
  applySimState: (simState: SimState) => void
}

/**
 * 虚拟时钟钩子（服务端权威 + 客户端插值）：
 * 会话状态（dayIndex/status/lastTickAt）与账户账务全部由 BFF 结算持久化（node:sqlite），
 * 本钩子负责：boot 拉取权威状态 → live 按 ~1s 轮询校准 → 进度条用 serverNow + lastTickAt 本地插值；
 * K 线数据仍按需拉取内存缓存（图表与委托面板展示）。
 * 服务端时钟语义：页面关闭期间 running 照走；刷新后继续（不暂停追帧）。
 */
export const useReplay = (options: UseReplayOptions): UseReplayResult => {
  const { anchorCode, codes, onAccountSync } = options

  const [phase, setPhase] = useState<ReplayPhase>('boot')
  const [state, setState] = useState<SimSession | null>(null)
  const [calendar, setCalendar] = useState<string[]>([])
  const [startRange, setStartRange] = useState<ReplayStartRange | null>(null)
  const [error, setError] = useState(false)
  const [barsVersion, setBarsVersion] = useState(0)
  const [bootId, setBootId] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())

  const barsRef = useRef<Map<string, KLineData[]>>(new Map())
  const pendingRef = useRef<Set<string>>(new Set())
  const anchorRef = useRef(anchorCode)
  const onAccountSyncRef = useRef(onAccountSync)
  /** 服务端时钟校准锚点（serverNow + 本地流逝 = 插值用的服务端当前时间；随权威响应更新） */
  const [sync, setSync] = useState<{ serverNow: number; localAt: number }>({ serverNow: 0, localAt: 0 })

  useEffect(() => {
    anchorRef.current = anchorCode
  }, [anchorCode])

  useEffect(() => {
    onAccountSyncRef.current = onAccountSync
  }, [onAccountSync])

  const syncState = useCallback((simState: SimState) => {
    setSync({ serverNow: simState.serverNow, localAt: Date.now() })
    if (simState.session != null) {
      setState(simState.session)
    }
    onAccountSyncRef.current?.(simState.account)
  }, [])

  // 引导：拉取服务端权威状态 + 锚定标的全量日 K；有会话恢复 live，否则进 setup 选日期
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
      const [simState, bars] = await Promise.all([
        fetchSimState(),
        fetchReplayBars(anchorRef.current, REPLAY_FETCH_BARS)
      ])
      if (cancelled) {
        return
      }
      if (simState == null || bars.length < 3) {
        setError(true)
        return
      }
      syncState(simState)
      const session = simState.session
      const anchor = session?.anchorCode ?? anchorRef.current
      const anchorBars = anchor === anchorRef.current ? bars : await fetchReplayBars(anchor, REPLAY_FETCH_BARS)
      if (cancelled) {
        return
      }
      barsRef.current = new Map([[anchor, anchorBars]])
      setBarsVersion((v) => v + 1)
      if (session != null) {
        // 服务端时钟：恢复不暂停（running 继续走，ended 保持结束态）
        setCalendar(calendarFrom(anchorBars, session.startDate))
        setPhase('live')
        return
      }
      setStartRange(startRangeOf(anchorBars))
      setPhase('setup')
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [bootId, syncState])

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
      const results = await Promise.all(missing.map((code) => fetchReplayBars(code, REPLAY_FETCH_BARS)))
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

  // 权威轮询：live running 时 ~1s 同步服务端状态（推进/暂停/结束都以下一次轮询为准）
  useEffect(() => {
    if (phase !== 'live' || state?.status !== 'running') {
      return
    }
    let cancelled = false
    const timer = setInterval(() => {
      void (async () => {
        const simState = await fetchSimState()
        if (cancelled || simState == null) {
          return
        }
        syncState(simState)
      })()
    }, SIM_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [phase, state?.status, syncState])

  // 插值时钟（1s 一拍，仅 running：进度条在两次轮询间平滑推进）
  useEffect(() => {
    if (phase !== 'live' || state?.status !== 'running') {
      return
    }
    const timer = setInterval(() => setNowTick(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [phase, state?.status])

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

  const start = useCallback(
    async (startDate: string, speedMs?: ReplaySpeedMs): Promise<boolean> => {
      const simState = await postSimSession({
        action: 'start',
        anchorCode: anchorRef.current,
        startDate,
        speedMs: speedMs ?? REPLAY_SPEEDS[1]
      })
      if (simState?.session == null) {
        return false
      }
      const bars = barsRef.current.get(simState.session.anchorCode)
      setCalendar(bars != null ? calendarFrom(bars, startDate) : [])
      syncState(simState)
      setPhase('live')
      return true
    },
    [syncState]
  )

  const togglePause = useCallback(() => {
    if (state == null || state.status === 'ended') {
      return
    }
    void (async () => {
      const simState = await postSimSession({ action: state.status === 'running' ? 'pause' : 'resume' })
      if (simState != null) {
        syncState(simState)
      }
    })()
  }, [state, syncState])

  const setSpeed = useCallback(
    (ms: ReplaySpeedMs) => {
      if (state == null || state.speedMs === ms) {
        return
      }
      void (async () => {
        const simState = await postSimSession({ action: 'speed', speedMs: ms })
        if (simState != null) {
          syncState(simState)
        }
      })()
    },
    [state, syncState]
  )

  const restart = useCallback(async (): Promise<boolean> => {
    const simState = await postSimSession({ action: 'restart' })
    if (simState == null) {
      return false
    }
    syncState(simState)
    barsRef.current.clear()
    pendingRef.current.clear()
    setBootId((id) => id + 1)
    return true
  }, [syncState])

  const retry = useCallback(() => {
    setBootId((id) => id + 1)
  }, [])

  const applySimState = useCallback(
    (simState: SimState) => {
      syncState(simState)
    },
    [syncState]
  )

  /** 进度：服务端时钟插值 (serverNow + 本地流逝 - lastTickAt) / speedMs，轮询周期内平滑 */
  const progress =
    state?.status === 'running'
      ? Math.min(1, Math.max(0, (sync.serverNow + (nowTick - sync.localAt) - state.lastTickAt) / state.speedMs))
      : 0

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
    retry,
    applySimState
  }
}
