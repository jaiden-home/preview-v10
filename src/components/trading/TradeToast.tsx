'use client'

import type { TradeNotice } from './useNotice'

/**
 * Toast 呈现（UI_SPEC §3.9 v2.53 双轨）：scope = trade 加 `.panel` 修饰（委托面板卡内
 * 顶部居中悬浮），global 为页面底部居中——弹出位置由父级按 scope 条件挂载到对应宿主节点。
 */
export default function TradeToast({ notice }: { notice: TradeNotice }) {
  return (
    <div className={`trade-toast${notice.scope === 'trade' ? ' panel' : ''} ${notice.kind}`} role="status">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
        {notice.kind === 'ok' ? (
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M7 7l10 10M17 7L7 17" strokeLinecap="round" />
        )}
      </svg>
      <span>{notice.text}</span>
    </div>
  )
}
