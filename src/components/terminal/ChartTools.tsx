'use client'

import { MAIN_INDICATORS, SUB_INDICATORS } from '@/lib/chart/constants'
import type { Translate } from '@/lib/i18n'
import IndicatorMenu from './IndicatorMenu'
import DrawingMenu from './DrawingMenu'

interface ChartToolsProps {
  t: Translate
  /** 按钮与下拉的元素 id 前缀（行情页 ''，交易页 'trade-'），保证同页唯一 */
  idPrefix?: string
  mainIndicators: ReadonlySet<string>
  subIndicators: ReadonlySet<string>
  onMainIndicatorChange: (name: string, checked: boolean) => void
  onSubIndicatorChange: (name: string, checked: boolean) => void
  activeTool: string | null
  onDrawingSelect: (name: string) => void
  onClearDrawings: () => void
}

/** 图表工具组：主/副图指标 + 绘图工具 + 清除绘图（行情页与交易页工具栏的共用段） */
export default function ChartTools({
  t,
  idPrefix = '',
  mainIndicators,
  subIndicators,
  onMainIndicatorChange,
  onSubIndicatorChange,
  activeTool,
  onDrawingSelect,
  onClearDrawings
}: ChartToolsProps) {
  return (
    <>
      <IndicatorMenu
        buttonId={`${idPrefix}main-indicator-btn`}
        dropdownId={`${idPrefix}main-indicator-dropdown`}
        label={t('主图指标|Main Indicators')}
        names={MAIN_INDICATORS}
        selected={mainIndicators}
        onChange={onMainIndicatorChange}
      />
      <IndicatorMenu
        buttonId={`${idPrefix}sub-indicator-btn`}
        dropdownId={`${idPrefix}sub-indicator-dropdown`}
        label={t('副图指标|Sub Indicators')}
        names={SUB_INDICATORS}
        selected={subIndicators}
        onChange={onSubIndicatorChange}
      />
      <DrawingMenu activeTool={activeTool} t={t} onSelect={onDrawingSelect} />
      <div className="toolbar-item">
        <button className="tb-btn tb-clear" id={`${idPrefix}clear-btn`} type="button" onClick={onClearDrawings}>
          {t('清除绘图|Clear Drawings')}
        </button>
      </div>
    </>
  )
}
