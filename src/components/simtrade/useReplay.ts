'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KLineData } from 'klinecharts'
import { fetchReplayBars } from '@/lib/chart/api'
import type { TradingAccount } from '@/lib/trading/account'
import { advanceSessionBy, type SimSession, type SimState } from '@/lib/trading/protocol'
import {
  PRE_START_WINDOW_BARS,
  REPLAY_FETCH_MAX_BARS,
  REPLAY_SPEEDS,
  calendarFrom,
  dateKeyOfBar,
  estimateTradingBars,
  forwardCountOf,
  replayQuoteOf,
  startRangeOf,
  visibleDailyBarsOf,
  type ReplayQuote,
  type ReplaySpeedMs,
  type ReplayStartRange
} from '@/lib/trading/replay'
import { fetchSimState, postSimSession } from '@/lib/trading/sim-api'

/** 回放数据两阶段加载：setup 拉 PRE_START_WINDOW_BARS(500) 根用于选日期（起始日可选全历史）；
 *  start 时按所选起始日追拉——交易日估算一步到位，补齐起始日前 500 根历史窗口 + 全部模拟日，
 *  上限 REPLAY_FETCH_MAX_BARS（纯护栏；新股/超早日期回溯到上市全量即止；与服务端结算口径一致） */

/** 本地时钟节拍（running 时 1s 一拍：本地派生虚拟日推进 + 进度条插值，无网络轮询） */
const LOCAL_TICK_MS = 1_000

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
  /** setup 阶段：已加载窗口首根日期（所选日期早于此 → 可模拟天数仅为下界） */
  loadedWindowFirst: string
  /** 当前日计时进度 0..1（running 时；暂停/结束为 0） */
  progress: number
  /** bars 缓存版本号（任一标的拉取完成后 +1，驱动依赖方重算） */
  barsVersion: number
  /** 当前市场态（最新完成日收盘 + 前收） */
  quoteOf: (code: string) => ReplayQuote | null
  /** 图表可见日 K（起始日前历史 + 已完成模拟日） */
  visibleBarsOf: (code: string) => KLineData[]
  /** 已加载窗口日 K（未开局阶段图表展示实时完整 K 线，与 /trade 一致） */
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
 * 虚拟时钟钩子（服务端权威 + 本地派生，无轮询）：
 * 会话状态（dayIndex/status/lastTickAt）与账户账务由 BFF 结算持久化（node:sqlite），
 * boot 拉取一次权威状态后，running 期间由本地时钟（serverNow + lastTickAt + speedMs）
 * 派生虚拟日推进——回放数据不可变且前端已完整持有（历史窗口 + 模拟日），无需轮询；
 * 任何服务端交互（下单/暂停/继续/倍速/重开）的响应都会校准权威值。
 * K 线数据按需拉取内存缓存（图表与委托面板展示）。
 * 服务端时钟语义：页面关闭期间 running 照走；刷新后继续（不暂停追帧）。
 */
export const useReplay = (options: UseReplayOptions): UseReplayResult => {
  const { anchorCode, codes, onAccountSync } = options

  const [phase, setPhase] = useState<ReplayPhase>('boot')
  const [state, setState] = useState<SimSession | null>(null)
  const [calendar, setCalendar] = useState<string[]>([])
  const [startRange, setStartRange] = useState<ReplayStartRange | null>(null)
  const [loadedWindowFirst, setLoadedWindowFirst] = useState('')
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

  // 引导：拉取服务端权威状态 + 锚定标的窗口日 K（500 根）；有会话恢复 live，否则进 setup 选日期
  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      setPhase('boot')
      setError(false)
      setState(null)
      setCalendar([])
      setStartRange(null)
      setLoadedWindowFirst('')
      barsRef.current = new Map()
      pendingRef.current.clear()
      const [simState, bars] = await Promise.all([
        fetchSimState(),
        fetchReplayBars(anchorRef.current, PRE_START_WINDOW_BARS)
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
      let anchorBars = anchor === anchorRef.current ? bars : await fetchReplayBars(anchor, PRE_START_WINDOW_BARS)
      if (cancelled) {
        return
      }
      // 恢复会话：按「起始日前 500 历史 + 全部模拟日」口径补拉（与 start() 一致；新股数据尽头即止）；
      // 目标钳制到 API 上限，防异常 dayCount 构造出超限请求（正常会话 ≤999，不会触发）
      if (session != null && anchorBars.length < PRE_START_WINDOW_BARS + session.dayCount) {
        const target = Math.min(PRE_START_WINDOW_BARS + session.dayCount, REPLAY_FETCH_MAX_BARS)
        const fetched = await fetchReplayBars(anchor, target)
        if (!cancelled && fetched.length > anchorBars.length) {
          anchorBars = fetched
        }
      }
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
      setLoadedWindowFirst(dateKeyOfBar(anchorBars[1]!))
      setPhase('setup')
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [bootId, syncState])

  const codesKey = Array.from(new Set(codes)).sort().join(',')

  // 按需拉取：选中/持仓标的窗口日 K（500 根；失败缓存空数组，重进页面再试）
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
      const results = await Promise.all(missing.map((code) => fetchReplayBars(code, PRE_START_WINDOW_BARS)))
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

  // 本地时钟节拍（1s 一拍，仅 running：驱动本地派生虚拟日推进与进度条插值）
  useEffect(() => {
    if (phase !== 'live' || state?.status !== 'running') {
      return
    }
    const timer = setInterval(() => setNowTick(Date.now()), LOCAL_TICK_MS)
    return () => clearInterval(timer)
  }, [phase, state?.status])

  // 展示态 = 服务端权威 session + 本地时钟派生推进（与服务端 settle 同一函数，零口径漂移）。
  // 回放数据不可变且前端已完整持有（历史窗口 + 模拟日），无需轮询；服务端交互响应校准权威值
  const serverNowEst = sync.serverNow + (nowTick - sync.localAt)
  const simState = state == null ? null : advanceSessionBy(state, serverNowEst)
  const dayIndex = simState?.dayIndex ?? 0

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
      const anchor = anchorRef.current
      let bars = barsRef.current.get(anchor)
      if (bars != null) {
        // 起始日前历史不足窗口根数时追拉：交易日估算一步到位（过冲无害），循环仅兜底补差；
        // 起始日早于已加载窗口（估算未知精确模拟天数）与新股数据尽头均由此收敛
        for (let round = 0; round < 3; round += 1) {
          const forwardCount = forwardCountOf(bars, startDate)
          const startIndex = bars.findIndex((b) => dateKeyOfBar(b) >= startDate)
          const historyLoaded = Math.max(0, startIndex)
          if (historyLoaded >= PRE_START_WINDOW_BARS) {
            break
          }
          const estimatedForward = startIndex === 0 ? estimateTradingBars(startDate) : forwardCount
          const target = Math.min(
            Math.max(
              bars.length + (PRE_START_WINDOW_BARS - historyLoaded),
              PRE_START_WINDOW_BARS + Math.max(forwardCount, estimatedForward)
            ),
            REPLAY_FETCH_MAX_BARS
          )
          const fetched = await fetchReplayBars(anchor, target)
          if (fetched.length <= bars.length) {
            break
          }
          bars = fetched
          barsRef.current.set(anchor, bars)
          setBarsVersion((v) => v + 1)
        }
      }
      const simState = await postSimSession({
        action: 'start',
        anchorCode: anchor,
        startDate,
        speedMs: speedMs ?? REPLAY_SPEEDS[1]
      })
      if (simState?.session == null) {
        return false
      }
      setCalendar(bars != null ? calendarFrom(bars, startDate) : [])
      syncState(simState)
      setPhase('live')
      return true
    },
    [syncState]
  )

  const togglePause = useCallback(() => {
    // 用本地派生态判断（到顶 ended 即停止操作；服务端对已 ended 会话的暂停/继续同样是 no-op）
    if (simState == null || simState.status === 'ended') {
      return
    }
    void (async () => {
      const next = await postSimSession({ action: simState.status === 'running' ? 'pause' : 'resume' })
      if (next != null) {
        syncState(next)
      }
    })()
  }, [simState, syncState])

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

  /** 进度：派生态的 lastTickAt 已随本地时钟推进到当前虚拟日起点，直接求当前日占比 */
  const progress =
    simState?.status === 'running'
      ? Math.min(1, Math.max(0, (serverNowEst - simState.lastTickAt) / simState.speedMs))
      : 0

  return {
    phase,
    error,
    state: simState,
    calendar,
    startRange,
    loadedWindowFirst,
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
