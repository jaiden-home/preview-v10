'use client'

import { useCallback, useEffect, useState } from 'react'

/** Toast 反馈层级（UI_SPEC §3.9 v2.53）：trade = 交易反馈（委托面板内弹出）；global = 账户级/系统级（页面底部居中） */
export type NoticeScope = 'trade' | 'global'

export interface TradeNotice {
  kind: 'ok' | 'err'
  /** 已翻译文本（产生侧经 t() 或直接拼接，展示端不再翻译） */
  text: string
  scope: NoticeScope
}

/**
 * 交易页 Toast 通知状态：单一 notice + 3s 自动消隐。
 * 文案来自 lib/trading/messages 目录（msg()）或服务端 rejection message，经 t() 翻译后传入；
 * scope 决定弹出宿主——trade 挂 #trade-order-panel 内、global 挂页面根（见 TradeToast）。
 */
export const useNotice = () => {
  const [notice, setNotice] = useState<TradeNotice | null>(null)

  useEffect(() => {
    if (notice == null) {
      return
    }
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  const notify = useCallback((kind: TradeNotice['kind'], text: string, scope: NoticeScope) => {
    setNotice({ kind, text, scope })
  }, [])

  return { notice, notify }
}
