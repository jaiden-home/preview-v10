'use client'

import { useEffect, useState } from 'react'
import { buildCalcParams, buildParamRowMetas } from '@/lib/chart/params'
import type { Translate } from '@/lib/i18n'

export interface ModalIndicator {
  name: string
  paneId: string
  calcParams: number[]
}

interface IndicatorModalProps {
  indicators: ModalIndicator[]
  t: Translate
  onClose: () => void
  onConfirm: (paneId: string, name: string, calcParams: number[]) => void
}

/**
 * 指标参数设置弹窗（中英文参数标签、最小值钳制、整数/小数参数区分）。
 * 由父组件条件挂载（每次打开重新挂载，选中态自然复位）。
 */
export default function IndicatorModal({ indicators, t, onClose, onConfirm }: IndicatorModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const current = indicators[selectedIndex]
  const rows = current != null ? buildParamRowMetas(current.calcParams, current.name, t) : []

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (current == null) {
      onClose()
      return
    }
    const formData = new FormData(event.currentTarget)
    const inputs = rows.map((row) => ({
      value: String(formData.get(row.label) ?? ''),
      min: String(row.min),
      step: String(row.step)
    }))
    onConfirm(current.paneId, current.name, buildCalcParams(inputs))
    onClose()
  }

  return (
    <div
      className="modal-mask open"
      id="indicator-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{t('指标设置|Indicator Settings')}</span>
          <button className="modal-close" id="indicator-modal-close" type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <select
              className="tb-select modal-select"
              id="indicator-select"
              value={current != null ? String(selectedIndex) : '-1'}
              onChange={(event) => setSelectedIndex(Number(event.target.value))}
            >
              {indicators.length === 0 && <option value="-1">{t('暂无指标|No indicators')}</option>}
              {indicators.map((indicator, index) => (
                <option key={`${indicator.paneId}-${indicator.name}`} value={index}>
                  {indicator.name}
                  {indicator.paneId === 'candle_pane' ? t('（主图）| (Main)') : t('（副图）| (Sub)')}
                </option>
              ))}
            </select>
            <div className="param-list" id="param-list">
              {rows.length === 0 && <div className="symbol-empty">{t('该指标无可设置参数|No parameters')}</div>}
              {rows.map((row) => (
                <div key={row.label} className="param-row">
                  <span className="param-label">{row.label}</span>
                  <input
                    className="param-input"
                    name={row.label}
                    type="number"
                    defaultValue={row.value}
                    min={row.min}
                    step={row.step}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button className="tb-btn modal-btn" id="indicator-modal-cancel" type="button" onClick={onClose}>
              {t('取消|Cancel')}
            </button>
            <button className="tb-btn modal-btn primary" id="indicator-modal-confirm" type="submit">
              {t('确定|OK')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
