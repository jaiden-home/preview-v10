'use client'

import { REPLAY_SPEEDS, type ReplaySpeedMs, type ReplayStartRange, type ReplayState } from '@/lib/trading/replay'

interface SimClockBarProps {
  t: (key: string) => string
  /** setup = 未开局（日期可改 + 开始模拟）；live = 模拟进行/暂停/结束 */
  mode: 'setup' | 'live'
  state: ReplayState | null
  calendar: string[]
  /** 距下一交易日的计时进度 0..1（暂停/结束为 0） */
  progress: number
  /** setup：当前所选起始日（可改）；live：最新完成交易日（展示） */
  date: string
  /** setup：可选起始日范围 */
  range: ReplayStartRange | null
  /** setup：自所选日起可模拟的交易日数 */
  forwardDays: number
  speedMs: ReplaySpeedMs
  onDateChange: (date: string) => void
  onStart: () => void
  onToggle: () => void
  onSpeedChange: (ms: ReplaySpeedMs) => void
}

const speedLabel: Record<number, string> = {
  15_000: '15秒|15s',
  30_000: '30秒|30s',
  60_000: '60秒|60s'
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M8 5l11 7-11 7V5z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * 模拟时钟（UI_SPEC §3.13，两行控制卡）：
 * 行 1 = 时间锚点 + 主操作（setup：起始日输入 + 「开始模拟」；live：虚拟日期大字 + 第 x/N 天 + 暂停/继续）；
 * 行 2 = 整行计时进度 + 倒计时文案（setup：可模拟天数提示）；
 * 行 3 = 倍速分段（15/30/60 秒 = 1 交易日）。
 */
export default function SimClockBar({
  t,
  mode,
  state,
  calendar,
  progress,
  date,
  range,
  forwardDays,
  speedMs,
  onDateChange,
  onStart,
  onToggle,
  onSpeedChange
}: SimClockBarProps) {
  const setup = mode === 'setup'
  const live = !setup && state != null
  const running = state?.status === 'running'
  const ended = state?.status === 'ended'
  const liveDay = live ? (calendar[state!.dayIndex - 1] ?? state!.startDate) : date
  const days = forwardDays > 0 ? Math.min(forwardDays, 500) : 0
  // 至少 2 个交易日（大于 1 日）才能开始模拟
  const startDisabled = setup && (date === '' || days <= 1)
  const clamped = Math.min(1, Math.max(0, progress))
  const pct = Math.round(clamped * 100)
  const remainSec = state != null ? Math.max(0, Math.ceil(((1 - clamped) * state.speedMs) / 1000)) : 0

  return (
    <div className="sim-clock" role="group" aria-label={t('模拟时钟|Replay clock')}>
      {/* 行 1：时间锚点 + 主操作 */}
      <div className="sim-clock-head">
        {setup ? (
          <label className="sim-clock-start">
            <span className="sim-start-label">{t('起始日期|Start date')}</span>
            <input
              className="sim-date-input"
              type="date"
              value={date}
              min={range?.min}
              max={range?.max}
              aria-label={t('选择起始日期|Pick a start date')}
              onChange={(e) => onDateChange(e.target.value)}
            />
          </label>
        ) : (
          <div className="sim-clock-day">
            <span className="sim-day-value num">{liveDay}</span>
            {live && (
              <span className="sim-day-meta num">
                {t(`第 ${state!.dayIndex}/${state!.dayCount} 个交易日|Day ${state!.dayIndex} of ${state!.dayCount}`)}
              </span>
            )}
          </div>
        )}
        {setup ? (
          <button type="button" className="sim-toggle-btn" disabled={startDisabled} onClick={onStart}>
            <PlayIcon />
            <span>{t('开始模拟|Start')}</span>
          </button>
        ) : ended ? (
          <span className="sim-ended-tag">{t('已结束|Ended')}</span>
        ) : (
          <button type="button" className="sim-toggle-btn" onClick={onToggle}>
            {running ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 5v14" strokeLinecap="round" />
                <path d="M15 5v14" strokeLinecap="round" />
              </svg>
            ) : (
              <PlayIcon />
            )}
            <span>{running ? t('暂停|Pause') : t('继续|Resume')}</span>
          </button>
        )}
      </div>

      {/* 行 2：计时进度 / 可模拟天数 */}
      <div className="sim-clock-track">
        {live ? (
          <>
            <span
              className="sim-progress"
              role="progressbar"
              aria-label={t('距下一交易日|Time to next day')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              {/* 数据驱动的动态宽度（同涨跌色例外，非样式硬编码） */}
              <span className="sim-progress-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="sim-countdown num">
              {ended
                ? t('已结束|Ended')
                : running
                  ? t(`交易时间还剩余 ${remainSec} 秒|${remainSec}s left in this trading day`)
                  : t('已暂停|Paused')}
            </span>
          </>
        ) : (
          <span className="sim-clock-hint">
            {date === ''
              ? t('请选择起始日期|Pick a start date')
              : days > 1
                ? t(`自该日起共 ${days} 个交易日|${days} trading days`)
                : t('交易日不足，请选择更早的起始日期|Not enough trading days; pick an earlier start date')}
          </span>
        )}
      </div>

      {/* 行 3：倍速 */}
      <span className="sim-speed-group" role="group" aria-label={t('倍速|Speed')}>
        {REPLAY_SPEEDS.map((ms) => (
          <button
            key={ms}
            type="button"
            className={`sim-speed-btn${speedMs === ms ? ' active' : ''}`}
            aria-pressed={speedMs === ms}
            onClick={() => onSpeedChange(ms)}
          >
            {t(speedLabel[ms])}
          </button>
        ))}
      </span>
    </div>
  )
}
