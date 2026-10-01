import type { Translate } from '@/lib/i18n'
import type { ReplayState } from '@/lib/trading/replay'

/** 收尾倒计时阈值（秒）：进入区间时钟宿主背景闪一下 + 标题旁出现圆形倒计时环徽记 */
export const URGENT_SECONDS = 10

/** 倒计时环周长（r = 8.5）：dasharray 基数，dashoffset 随剩余秒数递减 */
export const RING_C = 2 * Math.PI * 8.5

/**
 * 融合时钟派生（/simtrade，UI_SPEC §3.13）：running / 进度百分比 / 距下一交易日剩余秒 / 收尾态。
 * 时钟宿主两处——桌面 order-head（OrderPanel）与移动端交易坞条（SimTrading .trade-dock-bar.sim），
 * 共用本派生保证两端口径一致。
 */
export function simClockOf(
  simState: ReplayState | null | undefined,
  simProgress: number
): { running: boolean; pct: number; remainSec: number; urgent: boolean } {
  const running = simState?.status === 'running'
  const clamped = Math.min(1, Math.max(0, simProgress))
  const pct = Math.round(clamped * 100)
  const remainSec = simState != null ? Math.max(0, Math.ceil(((1 - clamped) * simState.speedMs) / 1000)) : 0
  return { running, pct, remainSec, urgent: running && remainSec <= URGENT_SECONDS }
}

/**
 * 融合时钟进度覆盖层：与宿主底缘基线（1px dashed --chart-grid）同几何的虚线，
 * 自左逐点点亮（--up 红），宽度为数据驱动内联值（禁过渡宽高）。
 */
export function SimHeadProgress({ t, pct }: { t: Translate; pct: number }) {
  return (
    <span
      className="sim-head-progress"
      role="progressbar"
      aria-label={t('当前交易日进度|Current trading day progress')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      style={{ width: `${pct}%` }}
    />
  )
}

/** 收尾 10 秒：随标题并排的圆形倒计时环（弧随剩余秒数收缩、环心剩余秒数，日推进/暂停即卸载消失） */
export function SimClockBadge({ t, remainSec }: { t: Translate; remainSec: number }) {
  return (
    <span
      className="sim-clock-badge"
      role="timer"
      aria-label={t(`距下一交易日 ${remainSec} 秒|${remainSec}s to next trading day`)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {/* 轨道环（低透明度衬底） */}
        <circle className="sim-count-track" cx="12" cy="12" r="8.5" />
        {/* 倒计时弧：顺时针收缩（起点随秒数顺时针推进、止于 12 点），负 dashoffset 数据驱动内联值 */}
        <circle
          className="sim-count-arc"
          cx="12"
          cy="12"
          r="8.5"
          strokeDasharray={RING_C}
          strokeDashoffset={-RING_C * (1 - remainSec / URGENT_SECONDS)}
          strokeLinecap="round"
        />
      </svg>
      {/* 环心剩余秒数（aria 信息已由徽记 label 承载） */}
      <span className="sim-count-num" aria-hidden="true">
        {remainSec}
      </span>
    </span>
  )
}
