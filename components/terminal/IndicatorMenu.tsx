'use client'

import { useState } from 'react'
import { useDismiss } from './useDismiss'

interface IndicatorMenuProps {
  buttonId: string
  dropdownId: string
  label: string
  names: string[]
  selected: ReadonlySet<string>
  onChange: (name: string, checked: boolean) => void
}

/** 主图/副图指标开关下拉（复选列表） */
export default function IndicatorMenu({ buttonId, dropdownId, label, names, selected, onChange }: IndicatorMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useDismiss(open, () => setOpen(false))

  return (
    <div className="toolbar-item" ref={wrapRef}>
      <button className="tb-btn tb-dd" id={buttonId} type="button" onClick={() => setOpen((prev) => !prev)}>
        {label}
      </button>
      <div className={`dropdown indicator-dropdown${open ? ' open' : ''}`} id={dropdownId}>
        {names.map((name) => (
          <label className="check-row" key={name}>
            <input
              type="checkbox"
              value={name}
              checked={selected.has(name)}
              onChange={(event) => onChange(name, event.target.checked)}
            />
            {name}
          </label>
        ))}
      </div>
    </div>
  )
}
