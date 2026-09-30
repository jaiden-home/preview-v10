'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KLineData } from 'klinecharts'
import { fetchReplayView } from '@/lib/chart/api'
import type { TradingAccount } from '@/lib/trading/account'
import { advanceSessionBy, type SimSession, type SimState } from '@/lib/trading/protocol'
import {
  AUTO_END_DATE,
  AUTO_START_DATE,
  dateKeyOfBar,
  replayQuoteOf,
  visibleDailyBarsOf,
  type ReplayQuote
} from '@/lib/trading/replay'
import { fetchSimState, postSimSession } from '@/lib/trading/sim-api'

/** 回放数据 = 服务端算好的视图（SimState.replay / /api/sim/replay?symbol=）：
 *  history（起始日前历史）+ simDays（全部模拟日，含未完成），前端按 dayIndex 揭示，不做窗口计算 */

/** 本地时钟节拍（running 时 1s 一拍：本地派生虚拟日推进 + 进度条插值，无网络轮询） */
const LOCAL_TICK_MS = 1_000

/** boot = 引导（拉状态 + 无会话时自动开局）；live = 模拟进行/暂停/结束 */
export type ReplayPhase = 'boot' | 'live'

export interface UseReplayOptions {
  /** 新局锚定标的（开局时的选中标的，提供共享交易日历） */
  anchorCode: string
  /** 需要回放行情的标的（选中 + 持仓），按需拉取并内存缓存 */
  codes: string[]
  /** 服务端权威账户同步（boot/会话操作后回调） */
  onAccountSync?: (account: TradingAccount) => void
}

export interface UseReplayResult {
  phase: ReplayPhase
  /** 引导失败（状态或数据源不可用/自动开局被拒），提示重试 */
  error: boolean
  state: SimSession | null
  calendar: string[]
  /** 当前日计时进度 0..1（running 时；暂停/结束为 0） */
  progress: number
  /** bars 缓存版本号（任一标的拉取完成后 +1，驱动依赖方重算） */
  barsVersion: number
  /** 当前市场态（最新完成日收盘 + 前收） */
  quoteOf: (code: string) => ReplayQuote | null
  /** 图表可见日 K（起始日前历史 + 已完成模拟日） */
  visibleBarsOf: (code: string) => KLineData[]
  /** 标的名称（随视图由服务端带回；无则 null，调用方回退代码） */
  nameOf: (code: string) => string | null
  /** 重开一局（服务端清会话与账户，boot 以默认区间重新自动开局）；返回是否成功 */
  restart: () => Promise<boolean>
  /** 引导失败后重试 */
  retry: () => void
  /** 下单响应等即时同步服务端权威状态（账户由调用方处理） */
  applySimState: (simState: SimState) => void
}

/**
 * 虚拟时钟钩子（服务端权威 + 本地派生，无轮询）：
 * 会话状态（dayIndex/status/lastTickAt）与账户账务由 BFF 结算持久化（node:sqlite），
 * boot 拉取一次权威状态——已有会话直接恢复；无会话则以固定区间
 * （AUTO_START_DATE ~ AUTO_END_DATE，开局即起走）自动开局。
 * running 期间由本地时钟（serverNow + lastTickAt + speedMs）派生虚拟日推进——
 * 回放数据不可变且前端已完整持有（历史窗口 + 模拟日），无需轮询；
 * 任何服务端交互（下单/重开）的响应都会校准权威值；暂停/继续由模拟设置页（/admin/simtrade）发起。
 * K 线数据按需拉取内存缓存（图表与委托面板展示）。
 * 服务端时钟语义：页面关闭期间 running 照走；刷新后继续（不暂停追帧）。
 */
export const useReplay = (options: UseReplayOptions): UseReplayResult => {
  const { anchorCode, codes, onAccountSync } = options

  const [phase, setPhase] = useState<ReplayPhase>('boot')
  const [state, setState] = useState<SimSession | null>(null)
  const [calendar, setCalendar] = useState<string[]>([])
  const [error, setError] = useState(false)
  const [barsVersion, setBarsVersion] = useState(0)
  const [bootId, setBootId] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())

  const barsRef = useRef<Map<string, KLineData[]>>(new Map())
  /** 标的名称（随视图由服务端带回：boot 锚定 + 按需拉取） */
  const namesRef = useRef<Map<string, string | null>>(new Map())
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

  // 引导：零参数拉权威状态（含锚定标的回放视图；无会话则固定区间自动开局），视图直接渲染
  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      setPhase('boot')
      setError(false)
      setState(null)
      setCalendar([])
      barsRef.current = new Map()
      namesRef.current = new Map()
      pendingRef.current.clear()
      const simState = await fetchSimState()
      if (cancelled) {
        return
      }
      if (simState == null) {
        setError(true)
        return
      }
      syncState(simState)
      const anchor = simState.session?.anchorCode ?? anchorRef.current
      let view = simState.replay ?? null
      if (simState.session == null) {
        // 无会话：固定区间自动开局并立即起走（暂停/继续控制收敛至模拟设置页，本页无开关）
        const result = await postSimSession({
          action: 'start',
          anchorCode: anchor,
          startDate: AUTO_START_DATE,
          endDate: AUTO_END_DATE
        })
        if (cancelled) {
          return
        }
        if (result == null || !result.ok || result.state.session == null) {
          setError(true)
          return
        }
        view = result.state.replay ?? null
        syncState(result.state)
      }
      if (view == null || view.simDays.length < 2) {
        // 无视图/模拟日不足 = 服务端数据源不可用
        setError(true)
        return
      }
      // 视图即数据：历史 + 全部模拟日（含未完成，按 dayIndex 逐日揭示）+ 名称；
      // 服务端时钟：恢复不暂停（running 继续走，paused/ended 保持原态）
      barsRef.current = new Map([[anchor, [...view.history, ...view.simDays]]])
      namesRef.current = new Map([[anchor, view.name]])
      setBarsVersion((v) => v + 1)
      setCalendar(view.simDays.map(dateKeyOfBar))
      setPhase('live')
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [bootId, syncState])

  const codesKey = Array.from(new Set(codes)).sort().join(',')

  // 按需拉取：选中/持仓标的的回放视图（窗口由服务端从会话解析，仅 symbol 参数；失败缓存空数组，重进页面再试）
  useEffect(() => {
    if (phase !== 'live' || error || codesKey.length === 0) {
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
      const views = await Promise.all(missing.map((code) => fetchReplayView(code)))
      if (cancelled) {
        return
      }
      views.forEach((view, i) => {
        barsRef.current.set(missing[i]!, view == null ? [] : [...view.history, ...view.simDays])
        namesRef.current.set(missing[i]!, view?.name ?? null)
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

  /** 标的名称（随视图由服务端带回；无则 null，调用方回退代码） */
  const nameOf = (code: string): string | null => namesRef.current.get(code) ?? null

  const restart = useCallback(async (): Promise<boolean> => {
    const result = await postSimSession({ action: 'restart' })
    if (!result?.ok) {
      return false
    }
    syncState(result.state)
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
    progress,
    barsVersion,
    quoteOf,
    visibleBarsOf,
    nameOf,
    restart,
    retry,
    applySimState
  }
}
