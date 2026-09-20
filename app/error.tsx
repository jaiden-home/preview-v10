'use client'

import { useEffect } from 'react'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 错误上报挂点（可接 Sentry 等）
    console.error('terminal render error:', error)
  }, [error])

  return (
    <div className="ssr-skeleton-chart" style={{ flexDirection: 'column', gap: 12 }}>
      <div>行情服务暂时不可用，请稍后重试</div>
      <button className="tb-btn modal-btn" onClick={reset} style={{ border: '1px solid var(--tb-border)' }}>
        重试
      </button>
    </div>
  )
}
