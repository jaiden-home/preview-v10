'use client'

import { useState } from 'react'
import { PERIOD_OPTIONS, type PeriodKey } from '@/lib/chart/constants'
import type { Translate } from '@/lib/i18n'
import { useDismiss } from './useDismiss'

/** 主栏直接展示日/周/月，分时与分钟、时线周期收进「周期」菜单 */
const MAIN_PERIOD_KEYS = ['1d', '1w', '1M']

interface PeriodGroupProps {
  activeKey: PeriodKey
  t: Translate
  onChange: (key: PeriodKey) => void
  /** 精简模式：仅主栏日/周/月，省略「周期」更多菜单（交易页图表用） */
  simple?: boolean
}

export default function PeriodGroup({ activeKey, t, onChange, simple = false }: PeriodGroupProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const wrapRef = useDismiss(moreOpen, () => setMoreOpen(false))

  const mainOptions = PERIOD_OPTIONS.filter((o) => MAIN_PERIOD_KEYS.includes(o.key))
  const menuOptions = PERIOD_OPTIONS.filter((o) => !MAIN_PERIOD_KEYS.includes(o.key))

  // 菜单内周期选中时，「周期」按钮改为显示该周期并高亮
  const activeMenuText =
    activeKey === 'time'
      ? t('分时|Time')
      : menuOptions.find((o) => o.key === activeKey) != null
        ? t(menuOptions.find((o) => o.key === activeKey)!.text)
        : null

  return (
    <div className="toolbar-item period-group" id="period-group">
      {mainOptions.map((option) => (
        <button
          key={option.key}
          className={`tb-btn period-btn${activeKey === option.key ? ' active' : ''}`}
          type="button"
          onClick={() => onChange(option.key)}
        >
          {t(option.text)}
        </button>
      ))}
      {!simple && (
        <div className="toolbar-item" ref={wrapRef}>
          <button
            className={`tb-btn tb-dd${activeMenuText != null ? ' active' : ''}`}
            id="period-more-btn"
            type="button"
            onClick={() => setMoreOpen((prev) => !prev)}
          >
            {activeMenuText ?? t('周期|Period')}
          </button>
          <div className={`dropdown indicator-dropdown${moreOpen ? ' open' : ''}`} id="period-dropdown">
            <button
              className={`tb-btn tool-btn period-btn${activeKey === 'time' ? ' active' : ''}`}
              type="button"
              onClick={() => onChange('time')}
            >
              {t('分时|Time')}
            </button>
            {menuOptions.map((option) => (
              <button
                key={option.key}
                className={`tb-btn tool-btn period-btn${activeKey === option.key ? ' active' : ''}`}
                type="button"
                onClick={() => onChange(option.key)}
              >
                {t(option.text)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
