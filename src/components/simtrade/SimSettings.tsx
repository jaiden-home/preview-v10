'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useLocale } from '@/components/terminal/useLocale'
import { useDismiss } from '@/components/terminal/useDismiss'
import { fetchSymbolSearch } from '@/lib/chart/api'
import { DEFAULT_SYMBOLS } from '@/lib/chart/constants'
import type { SymbolSearchItem } from '@/lib/chart/types'
import { advanceSessionBy, type SimSessionAction, type SimState } from '@/lib/trading/protocol'
import {
  AUTO_END_DATE,
  AUTO_START_DATE,
  REPLAY_SPEED_MS,
  REPLAY_SPEED_PRESETS_MS,
  dateKeyOfBar,
  nearestSpeedPresetMs
} from '@/lib/trading/replay'
import { fetchSimState, postSimSession } from '@/lib/trading/sim-api'
import TradeToast from '@/components/trading/TradeToast'
import { useNotice } from '@/components/trading/useNotice'

/** 与 /simtrade 默认锚定标的一致（sh600999 招商证券） */
const DEFAULT_CODE = 'sh600999'
const DEFAULT_NAME = '招商证券'

/** 本地时钟节拍（running 时 1s 一拍，本地派生状态卡展示，与服务端零口径漂移） */
const TICK_MS = 1_000

/** 会话区间右端 = 回放视图最后一个模拟日（服务端算好的实际交易日） */
const endDayOf = (state: SimState): string | null => {
  const simDays = state.replay?.simDays
  return simDays != null && simDays.length > 0 ? dateKeyOfBar(simDays[simDays.length - 1]!) : null
}

/**
 * 模拟设置页（/admin/simtrade，UI_SPEC §3.14）：标的 / 起止日期 / 倍速 / 开始暂停开关 / 重置账户。
 * 服务端权威：无会话 boot 的自动开局仍用固定默认区间；本页改动即显式重开局——
 * 仅倍速变化走 speed 热切换（保留当前日进度不清账），标的/区间变化 = restart + start 清账重开。
 */
export default function SimSettings() {
  const { t } = useLocale()

  const [snapshot, setSnapshot] = useState<{ state: SimState; localAt: number } | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [reloadId, setReloadId] = useState(0)
  const [tick, setTick] = useState(() => Date.now())

  // 表单：标的 / 区间 / 倍速（以权威会话为初值，无会话 = 默认值）
  const [code, setCode] = useState(DEFAULT_CODE)
  const [name, setName] = useState<string | null>(DEFAULT_NAME)
  const [startDate, setStartDate] = useState(AUTO_START_DATE)
  const [endDate, setEndDate] = useState(AUTO_END_DATE)
  const [speedMs, setSpeedMs] = useState<number>(REPLAY_SPEED_MS)

  const [busy, setBusy] = useState(false)
  // 操作结果 Toast（§3.9 全局层：本页反馈均为页面级）
  const { notice, notify } = useNotice()

  // 标的搜索下拉
  const [pickOpen, setPickOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{ q: string; items: SymbolSearchItem[] } | null>(null)
  const pickRef = useDismiss(pickOpen, () => setPickOpen(false))

  const busyRef = useRef(false)
  const withBusy = async (task: () => Promise<void>): Promise<void> => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      await task()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // 拉权威状态并以其初始化表单
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoadError(false)
      const state = await fetchSimState()
      if (cancelled) {
        return
      }
      if (state == null) {
        setLoadError(true)
        return
      }
      setSnapshot({ state, localAt: Date.now() })
      setTick(Date.now())
      const session = state.session
      setCode(session?.anchorCode ?? DEFAULT_CODE)
      setName(state.replay?.name ?? (session == null ? DEFAULT_NAME : null))
      setStartDate(session?.startDate ?? AUTO_START_DATE)
      setEndDate(session != null ? (endDayOf(state) ?? '') : AUTO_END_DATE)
      setSpeedMs(session != null ? nearestSpeedPresetMs(session.speedMs) : REPLAY_SPEED_MS)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [reloadId])

  // running 时 1s 一拍（状态卡进度本地派生）
  useEffect(() => {
    if (snapshot?.state.session?.status !== 'running') {
      return
    }
    const timer = setInterval(() => setTick(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [snapshot?.state.session?.status])

  // 搜索 300ms 防抖（与 SymbolPicker 一致）；空查询展示默认标的
  const q = query.trim()
  useEffect(() => {
    if (q === '') {
      return
    }
    const timer = setTimeout(() => {
      void fetchSymbolSearch(q).then((items) => setSearch({ q, items }))
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  // ---------------- 派生态（与服务端 advanceSessionBy 同口径） ----------------

  const rawSession = snapshot?.state.session ?? null
  const serverNowEst = snapshot != null ? snapshot.state.serverNow + (tick - snapshot.localAt) : 0
  const simState = rawSession != null ? advanceSessionBy(rawSession, serverNowEst) : null
  const running = simState?.status === 'running'
  const ended = simState?.status === 'ended'
  const sessionEndDay = snapshot != null ? endDayOf(snapshot.state) : null
  const view = snapshot?.state.replay

  const nextSpeedMs = speedMs
  /** 区间未变（标的 + 起始日 + 结束日对齐；倍速另算） */
  const windowSame =
    simState != null &&
    !ended &&
    simState.anchorCode === code &&
    simState.startDate === startDate &&
    sessionEndDay === endDate
  const speedOnly = windowSame && simState!.speedMs !== nextSpeedMs
  const configChanged = simState == null || ended || !windowSame || speedOnly

  const startEndValid = startDate !== '' && (endDate === '' || startDate <= endDate)
  const speedSec = nextSpeedMs / 1000

  const statusText = ended
    ? t('已结束|Ended')
    : running
      ? t('运行中|Running')
      : simState != null
        ? t('已暂停|Paused')
        : t('未开局|Not started')

  // ---------------- 操作（服务端权威，响应即校准） ----------------

  const adopt = (next: SimState) => {
    setSnapshot((prev) => ({ state: { ...next, replay: next.replay ?? prev?.state.replay }, localAt: Date.now() }))
    setTick(Date.now())
  }

  /** 表单收敛到权威会话（开局成功后 endDate 取实际最后交易日，消除「未保存」错觉） */
  const syncForm = (state: SimState) => {
    const session = state.session
    if (session == null) {
      return
    }
    setCode(session.anchorCode)
    setName(state.replay?.name ?? null)
    setStartDate(session.startDate)
    setSpeedMs(nearestSpeedPresetMs(session.speedMs))
    setEndDate(endDayOf(state) ?? '')
  }

  const postControl = async (action: SimSessionAction, okText?: string): Promise<boolean> => {
    const res = await postSimSession(action)
    if (res != null && res.ok) {
      adopt(res.state)
      if (okText != null) {
        notify('ok', okText, 'global')
      }
      return true
    }
    notify(
      'err',
      res != null && !res.ok ? res.message : t('操作失败，请稍候重试|Action failed, please retry'),
      'global'
    )
    return false
  }

  /** restart + start 清账重开（「应用并重开」「保存并开局」「重置账户」共用核心；响应即校准表单） */
  const restartSession = async (startRunning: boolean, okText: string): Promise<void> => {
    const restartRes = await postSimSession({ action: 'restart' })
    const startRes =
      restartRes != null
        ? await postSimSession({
            action: 'start',
            anchorCode: code,
            startDate,
            endDate: endDate || undefined,
            speedMs: nextSpeedMs,
            paused: !startRunning
          })
        : null
    if (startRes != null && startRes.ok && startRes.state.session != null) {
      adopt(startRes.state)
      syncForm(startRes.state)
      notify('ok', okText, 'global')
    } else {
      notify(
        'err',
        startRes != null && !startRes.ok ? startRes.message : t('保存失败，请稍候重试|Save failed, please retry'),
        'global'
      )
      setReloadId((v) => v + 1)
    }
  }

  /** 保存设置核心（不包 busy，供按钮与开关复用）：仅倍速 = speed 热切换；否则 restart + start 清账重开 */
  const runApply = async (startRunning: boolean): Promise<void> => {
    if (!startEndValid) {
      return
    }
    if (speedOnly) {
      await postControl({ action: 'speed', speedMs: nextSpeedMs }, t('倍速已更新|Speed updated'))
      return
    }
    const account = snapshot?.state.account
    const hasContent = (account?.positions.length ?? 0) > 0 || (account?.trades.length ?? 0) > 0
    if (
      hasContent &&
      !window.confirm(
        t(
          '调整模拟参数将重开一局，清空持仓与成交记录。|Applying new params restarts the session and clears positions and trades.'
        )
      )
    ) {
      return
    }
    await restartSession(
      startRunning,
      startRunning
        ? t('已按新设置开局|Started with new settings')
        : t('设置已保存，点开关开始模拟|Settings saved; toggle to start')
    )
  }

  /** 重置账户：不论参数是否变化恒清账重开（自 /simtrade 账户摘要移入） */
  const handleResetAccount = () =>
    withBusy(async () => {
      if (!startEndValid) {
        return
      }
      if (
        !window.confirm(
          t(
            '确定重置账户？将清空全部持仓、成交记录与本局进度。|Reset the account? All positions, trades and replay progress will be cleared.'
          )
        )
      ) {
        return
      }
      await restartSession(true, t('账户已重置|Account reset'))
    })

  /** 开始/暂停开关：开 = 恢复或按当前设置开局（倍速变化先热切）；关 = 暂停 */
  const handleToggleRun = (next: boolean): Promise<void> =>
    withBusy(async () => {
      if (!next) {
        if (simState?.status === 'running') {
          await postControl({ action: 'pause' })
        }
        return
      }
      if (simState == null || ended || !windowSame) {
        await runApply(true)
        return
      }
      if (simState.speedMs !== nextSpeedMs) {
        await postControl({ action: 'speed', speedMs: nextSpeedMs })
      }
      if (simState.status === 'paused') {
        await postControl({ action: 'resume' }, t('已开始模拟|Simulation started'))
      }
    })

  const applyLabel = speedOnly
    ? t('保存倍速|Save speed')
    : simState != null && !ended
      ? t('应用并重开|Apply & restart')
      : t('保存并开局|Save & start')

  const searchItems = useMemo(() => (q === '' ? DEFAULT_SYMBOLS : search?.q === q ? search.items : []), [q, search])

  const pickButton = (
    <button type="button" className="sim-pick-btn" aria-expanded={pickOpen} onClick={() => setPickOpen((v) => !v)}>
      <span className="sim-pick-id">
        <span className="sim-pick-name">{name ?? code}</span>
        <span className="sim-pick-code num">{code}</span>
      </span>
      <svg
        className={`sim-pick-chevron${pickOpen ? ' open' : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )

  // 每次从 DOM 取反（同首页）：客户端导航往返后主题类随根节点保留
  const toggleTheme = () => {
    const root = document.getElementById('app')
    const next = !root?.classList.contains('dark')
    root?.classList.add('theme-switching')
    root?.classList.toggle('dark', next)
    window.setTimeout(() => root?.classList.remove('theme-switching'), 50)
  }

  const sessionSpeedSec = simState != null ? Math.round(simState.speedMs / 1000) : null
  const sessionSpeedText = sessionSpeedSec != null ? t(`${sessionSpeedSec}秒|${sessionSpeedSec}s`) : '--'

  return (
    <div className="sim-settings-page">
      <div className="toolbar">
        <div className="toolbar-item">
          <Link className="tb-btn tb-clear" href="/simtrade">
            ← {t('返回模拟|Back to simulation')}
          </Link>
        </div>
        <ThemeToggle t={t} onToggle={toggleTheme} />
      </div>

      {loadError ? (
        <div className="trade-loading">
          {t('加载失败|Failed to load')}
          <button type="button" className="tb-btn sim-retry-btn" onClick={() => setReloadId((v) => v + 1)}>
            {t('重试|Retry')}
          </button>
        </div>
      ) : snapshot == null ? (
        <div className="trade-loading">{t('加载中|Loading')}…</div>
      ) : (
        <div className="trade-scroll">
          <div className="sim-settings">
            {/* 卡 1：模拟设置（标的 / 区间 / 倍速） */}
            <section className="trade-card sim-set-card">
              <h3 className="sim-set-head">{t('模拟设置|Simulation settings')}</h3>

              <div className="sim-field">
                <label className="sim-field-label" htmlFor="sim-pick-input">
                  {t('模拟标的|Symbol')}
                </label>
                <div className="sim-pick" ref={pickRef}>
                  {pickButton}
                  {pickOpen && (
                    <div className="dropdown sim-pick-dropdown open">
                      <div className="search-box">
                        <input
                          id="sim-pick-input"
                          className="symbol-search-input"
                          placeholder={t('搜索代码或名称|Search code or name')}
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                        <button
                          className={`search-clear-btn${query !== '' ? ' visible' : ''}`}
                          type="button"
                          title={t('清空|Clear')}
                          onClick={(event) => {
                            event.stopPropagation()
                            setQuery('')
                          }}
                        >
                          ×
                        </button>
                      </div>
                      <div className="symbol-list">
                        {searchItems.length === 0 && <div className="symbol-empty">{t('无结果|No results')}</div>}
                        {searchItems.map((item) => {
                          const itemCode = `${item.market}${item.ticker}`
                          return (
                            <div
                              key={itemCode}
                              className={`symbol-row${itemCode === code ? ' selected' : ''}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setCode(itemCode)
                                setName(item.name)
                                setPickOpen(false)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  setCode(itemCode)
                                  setName(item.name)
                                  setPickOpen(false)
                                }
                              }}
                            >
                              <span className="symbol-ticker num">{item.ticker}</span>
                              <span className="symbol-name">{item.name}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="sim-field">
                <span className="sim-field-label">{t('模拟区间|Date range')}</span>
                <div className="sim-set-dates">
                  <input
                    type="date"
                    className="sim-set-input"
                    aria-label={t('开始日期|Start date')}
                    value={startDate}
                    max={endDate || undefined}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                  <span className="sim-set-dash" aria-hidden="true">
                    ~
                  </span>
                  <input
                    type="date"
                    className="sim-set-input"
                    aria-label={t('结束日期|End date')}
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </div>
                <span className={`sim-set-hint${startEndValid ? '' : ' invalid'}`}>
                  {startEndValid
                    ? t(
                        '区间内需至少 2 个交易日；结束日留空 = 回放至数据尽头|At least 2 trading days required; empty end = replay to the latest data'
                      )
                    : t('开始日期不能晚于结束日期|Start date must not be after end date')}
                </span>
              </div>

              <div className="sim-field">
                <span className="sim-field-label">{t('模拟倍速|Replay speed')}</span>
                <div className="period-group sim-speed-group" role="group" aria-label={t('模拟倍速|Replay speed')}>
                  {REPLAY_SPEED_PRESETS_MS.map((presetMs) => {
                    const sec = presetMs / 1000
                    return (
                      <button
                        key={presetMs}
                        type="button"
                        className={`tb-btn${speedMs === presetMs ? ' active' : ''}`}
                        onClick={() => setSpeedMs(presetMs)}
                      >
                        {t(`${sec}秒|${sec}s`)}
                      </button>
                    )
                  })}
                </div>
                <span className="sim-set-hint num">
                  {t(`当前：每交易日 ${speedSec} 秒|Current: ${speedSec}s per trading day`)}
                </span>
              </div>

              <button
                type="button"
                className="sim-set-apply"
                onClick={() => void withBusy(() => runApply(false))}
                disabled={busy || !startEndValid || !configChanged}
              >
                {applyLabel}
              </button>
            </section>

            {/* 卡 2：本局状态 + 开始暂停开关 */}
            <section className="trade-card sim-status-card">
              <h3 className="sim-set-head">{t('本局状态|Session status')}</h3>
              <div className="sim-settle-grid">
                <span className="sim-settle-cell">
                  <span className="sim-settle-label">{t('状态|Status')}</span>
                  <span className="sim-settle-value">{statusText}</span>
                </span>
                <span className="sim-settle-cell">
                  <span className="sim-settle-label">{t('进度|Progress')}</span>
                  <span className="sim-settle-value num">
                    {simState != null
                      ? t(
                          `第 ${simState.dayIndex}/${simState.dayCount} 个交易日|Day ${simState.dayIndex} of ${simState.dayCount}`
                        )
                      : '--'}
                  </span>
                </span>
                <span className="sim-settle-cell">
                  <span className="sim-settle-label">{t('标的|Symbol')}</span>
                  <span className="sim-settle-value">
                    {simState != null
                      ? ((view?.code === simState.anchorCode ? view.name : null) ?? simState.anchorCode)
                      : '--'}
                  </span>
                </span>
                <span className="sim-settle-cell">
                  <span className="sim-settle-label">{t('倍速|Speed')}</span>
                  <span className="sim-settle-value num">{sessionSpeedText}</span>
                </span>
                <span className="sim-settle-cell span-2">
                  <span className="sim-settle-label">{t('模拟区间|Date range')}</span>
                  <span className="sim-settle-value num">
                    {simState != null ? `${simState.startDate} ~ ${sessionEndDay ?? t('数据尽头|Data end')}` : '--'}
                  </span>
                </span>
              </div>
              <div className="sim-run-row">
                <span className="sim-run-info">
                  <span className="sim-run-label">{t('开始模拟|Run simulation')}</span>
                  <span className="sim-run-sub">
                    {ended
                      ? t('已结束，开启即按当前设置重开|Ended; turning on restarts with current settings')
                      : running
                        ? t('运行中，关闭即暂停|Running; turning off pauses')
                        : simState != null
                          ? t('已暂停，开启即继续|Paused; turning on resumes')
                          : t('未开局，开启即按当前设置开局|Not started; turning on starts with current settings')}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={running}
                  className="sim-run-btn"
                  onClick={() => handleToggleRun(!running)}
                  disabled={busy || loadError}
                >
                  <span className={`sim-run-switch${running ? ' on' : ''}`} aria-hidden="true">
                    <span className="sim-run-knob" />
                  </span>
                </button>
              </div>
              <button
                type="button"
                className="sim-reset-btn"
                onClick={handleResetAccount}
                disabled={busy || loadError || !startEndValid}
              >
                {t('重置账户|Reset account')}
              </button>
            </section>
          </div>
        </div>
      )}

      {notice != null && <TradeToast notice={notice} />}
    </div>
  )
}
