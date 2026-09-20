'use client'

import { useState } from 'react'
import { DRAWING_TOOLS } from '@/lib/chart/constants'
import type { Translate } from '@/lib/i18n'
import { useDismiss } from './useDismiss'

interface DrawingMenuProps {
  activeTool: string | null
  t: Translate
  onSelect: (name: string) => void
}

/** 绘图工具下拉：再次点击同一工具取消，绘制完成自动取消激活 */
export default function DrawingMenu({ activeTool, t, onSelect }: DrawingMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useDismiss(open, () => setOpen(false))

  return (
    <div className="toolbar-item" ref={wrapRef}>
      <button className="tb-btn tb-dd" id="drawing-btn" type="button" onClick={() => setOpen((prev) => !prev)}>
        {t('绘图|Drawing')}
      </button>
      <div className={`dropdown drawing-dropdown${open ? ' open' : ''}`} id="drawing-dropdown">
        {DRAWING_TOOLS.map((tool) => (
          <button
            key={tool.name}
            className={`tb-btn tool-btn${activeTool === tool.name ? ' active' : ''}`}
            type="button"
            onClick={() => onSelect(tool.name)}
          >
            {t(tool.text)}
          </button>
        ))}
      </div>
    </div>
  )
}
