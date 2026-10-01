'use client'

import type { ReplayState } from '@/lib/trading/replay'

interface SimClockBarProps {
  t: (key: string) => string
  /** 回放会话（live 形态恒有会话；null = 引导中，由调用方遮蔽） */
  state: ReplayState | null
  /** 距下一交易日的计时进度 0..1（暂停/结束为 0） */
  progress: number
}

/** 收尾倒计时阈值（秒）：进入区间整条转红提醒 */
const URGENT_SECONDS = 10

/**
 * 模拟时钟（UI_SPEC §3.13，单行仪表条，恒为 live 形态——进入页面即自动开局）：
 * 左 = 第 x/N 个交易日；右 = 倒计时（running =「N 秒后进入第 x+1 天」，收尾 10 秒整条红色提醒；
 * 暂停/结束显示状态文案）；底缘 2px 刻线 = 当日计时进度（数据驱动宽度，禁过渡宽高）。
 * 暂停/继续控制不在本页（收敛至 §3.14 模拟设置页的开始暂停开关）。
 * 倍速档位 = 每交易日 10/15/30/60 秒（REPLAY_SPEED_PRESETS_MS，默认 REPLAY_SPEED_MS 10 秒），经设置页调整。
 */
export default function SimClockBar({ t, state, progress }: SimClockBarProps) {
  const running = state?.status === 'running'
  const ended = state?.status === 'ended'
  const clamped = Math.min(1, Math.max(0, progress))
  const pct = Math.round(clamped * 100)
  const remainSec = state != null ? Math.max(0, Math.ceil(((1 - clamped) * state.speedMs) / 1000)) : 0
  const nextDay = state != null ? Math.min(state.dayIndex + 1, state.dayCount) : 0
  const urgent = running && remainSec <= URGENT_SECONDS

  return (
    <div className={`sim-clock${urgent ? ' urgent' : ''}`} role="group" aria-label={t('模拟时钟|Replay clock')}>
      <span className="sim-day-meta num">
        {state != null &&
          t(`第 ${state.dayIndex}/${state.dayCount} 个交易日|Day ${state.dayIndex} of ${state.dayCount}`)}
      </span>
      {/* 底缘进度刻线：数据驱动的动态宽度（同涨跌色例外，非样式硬编码） */}
      <span
        className="sim-progress"
        role="progressbar"
        aria-label={t('当前交易日进度|Current trading day progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="sim-progress-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="sim-countdown num">
        {state == null
          ? '…'
          : ended
            ? t('已结束|Ended')
            : running
              ? t(`${remainSec} 秒后进入第 ${nextDay} 天|Day ${nextDay} in ${remainSec}s`)
              : t('已暂停|Paused')}
      </span>
    </div>
  )
}
