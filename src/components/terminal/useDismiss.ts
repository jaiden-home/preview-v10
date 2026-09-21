'use client'

import { useEffect, useRef } from 'react'

/**
 * 下拉/弹窗外点击与 Esc 关闭。
 * 返回绑定在 .toolbar-item（触发器 + 面板的外层）上的 ref。
 */
export const useDismiss = (open: boolean, onClose: () => void) => {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onDocClick = (event: MouseEvent) => {
      if (wrapRef.current != null && !wrapRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  return wrapRef
}
