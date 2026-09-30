'use client'

import type { ReplayState } from '@/lib/trading/replay'

interface SimClockBarProps {
  t: (key: string) => string
  /** 回放会话（live 形态恒有会话；null = 引导中，由调用方遮蔽） */
  state: ReplayState | null
  calendar: string[]
  /** 距下一交易日的计时进度 0..1（暂停/结束为 0） */
  progress: number
  onToggle: () => void
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M8 5l11 7-11 7V5z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * 模拟时钟（UI_SPEC §3.13，两行控制卡，恒为 live 形态——进入页面即自动开局，无选日期表单）：
 * 行 1 = 虚拟日期大字 + 第 x/N 天 + 暂停/继续（ended 态换「已结束」胶囊）；
 * 行 2 = 整行计时进度 + 倒计时文案。
 * 倍速固定 10 秒 = 1 交易日（REPLAY_SPEED_MS），不提供选择。
 */
export default function SimClockBar({ t, state, calendar, progress, onToggle }: SimClockBarProps) {
  const live = state != null
  const running = state?.status === 'running'
  const ended = state?.status === 'ended'
  const liveDay = live ? (calendar[state!.dayIndex - 1] ?? state!.startDate) : ''
  const clamped = Math.min(1, Math.max(0, progress))
  const pct = Math.round(clamped * 100)
  const remainSec = state != null ? Math.max(0, Math.ceil(((1 - clamped) * state.speedMs) / 1000)) : 0

  return (
    <div className="sim-clock" role="group" aria-label={t('模拟时钟|Replay clock')}>
      {/* 行 1：虚拟日期 + 主操作 */}
      <div className="sim-clock-head">
        <div className="sim-clock-day">
          <span className="sim-day-value num">{liveDay}</span>
          {live && (
            <span className="sim-day-meta num">
              {t(`第 ${state!.dayIndex}/${state!.dayCount} 个交易日|Day ${state!.dayIndex} of ${state!.dayCount}`)}
            </span>
          )}
        </div>
        {ended ? (
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

      {/* 行 2：计时进度 */}
      <div className="sim-clock-track">
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
      </div>
    </div>
  )
}
