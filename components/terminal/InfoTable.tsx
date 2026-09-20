'use client'

import { buildInfoCells } from '@/lib/chart/info-cells'
import type { InfoSnapshot } from '@/lib/chart/terminal'
import type { Locale } from '@/lib/i18n'
import { createT } from '@/lib/i18n'

/** 信息表格：K线行情 + 基本面混排，服务端直出首帧（initialBars/quote 经 props 注入） */
export default function InfoTable({ info, locale }: { info: InfoSnapshot; locale: Locale }) {
  const t = createT(locale)
  const cells = buildInfoCells(info, locale)
  if (cells == null) {
    return (
      <div className="info-table" id="info-table">
        <div className="fundamental-loading">{t('加载中...|Loading...')}</div>
      </div>
    )
  }
  return (
    <div className="info-table" id="info-table">
      {cells.map((cell, i) => (
        <div key={`${cell.label}-${i}`} className={`info-cell ${cell.cellClass ?? ''}`}>
          <span className="info-label">{cell.label}</span>
          <span className="info-value" style={cell.color != null ? { color: cell.color } : undefined}>
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  )
}
