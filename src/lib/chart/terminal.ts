import type {
  AxisCreateRangeCallback,
  AxisCreateTicksCallback,
  AxisTick,
  CandleTooltipLegendsCustomCallback,
  Chart,
  KLineData,
  Period,
  TooltipLegend
} from 'klinecharts'
import type { FundamentalData, QuoteSnapshot } from './types'
import { symbolCode } from './types'
import { fetchQuoteSnapshot } from './api'
import {
  CN_DOWN_COLOR,
  CN_UP_COLOR,
  DEFAULT_AXIS_GAP,
  PERCENT_Y_AXIS_NAME,
  TIME_SHARE_AXIS_GAP,
  TIME_SHARE_TOTAL_BARS,
  findPeriodOption,
  type PeriodKey
} from './constants'
import {
  resetTimeShareState,
  symmetricRangeAround,
  timeShareAnchorIndex,
  timeShareState,
  TIME_SHARE_X_ANCHORS
} from './timeshare'
import { setupChartRegisters } from './registers'
import { createDataLoader } from './data-loader'
import { parseCnBarTime } from './utils'
import type { Locale } from '../i18n'

/** 信息表格快照（控制器 → React 单向数据流） */
export interface InfoSnapshot {
  dataList: KLineData[]
  hovered: KLineData | null
  fundamental: FundamentalData
  intraday: boolean
}

export interface ChartTerminalOptions {
  container: HTMLElement
  symbol: { market: string; ticker: string }
  initialBars: import('klinecharts').KLineData[] | null
  initialQuote: QuoteSnapshot | null
  locale: Locale
  /** 信息表格数据变更（十字光标 / 数据刷新 / 基本面到达） */
  onInfoUpdate: (snapshot: InfoSnapshot) => void
  /** 切换标的后行情快照到达（更新按钮文案等） */
  onQuoteArrived?: (quote: QuoteSnapshot) => void
  /** 绘图完成（用于清除工具栏激活态） */
  onDrawingEnd?: () => void
}

/**
 * 图表终端控制器：封装 klinecharts 的全部命令式交互
 * （初始化/注册、数据加载、分时状态机、十字光标联动、主题、绘图、指标参数）。
 * React 层只持有状态与渲染，命令通过本类的方法下发。
 * klinecharts 依赖 DOM 与 Canvas，仅在客户端 effect 中实例化。
 */
export class ChartTerminal {
  private chart: Chart | null = null
  private klinechartsModule: typeof import('klinecharts') | null = null
  private readonly disposers: Array<() => void> = []
  private percentAxisId: string | null = null
  private hoverBar: KLineData | null = null
  private mouseSelectEnabled = true
  private activeTool: string | null = null
  private drawingOverlayId: string | null = null
  private latestFundamental: FundamentalData
  private destroyed = false

  constructor(private readonly options: ChartTerminalOptions) {
    this.latestFundamental = options.initialQuote?.fundamental ?? {}
  }

  // ==================== 生命周期 ====================

  async init(): Promise<void> {
    const klinecharts = await import('klinecharts')
    if (this.destroyed) {
      return
    }
    this.klinechartsModule = klinecharts
    await setupChartRegisters(this.options.locale)

    const chart = klinecharts.init(this.options.container, {
      locale: this.options.locale,
      timezone: 'Asia/Shanghai'
    })
    if (!chart) {
      return
    }
    this.chart = chart

    chart.setDataLoader(
      createDataLoader({
        chart,
        applyTimeShareTransforms: () => this.applyTimeShareTransforms(),
        calibrateTimeShareFit: (count) => this.calibrateTimeShareFit(count),
        fitTimeShareBars: (count) => this.fitTimeShareBars(count),
        initial:
          this.options.initialBars != null && this.options.initialBars.length > 0
            ? { code: symbolCode(this.options.symbol), bars: this.options.initialBars }
            : null
      })
    )
    this.setSymbol(this.options.symbol)
    this.applyCnColorScheme()
    this.applyTooltipStyles()
    chart.createIndicator({ name: 'MA', paneId: 'candle_pane' }, true)
    chart.createIndicator({ name: 'VOL' })
    chart.createIndicator({ name: 'MACD' })
    chart.setPeriod({ span: 1, type: 'day' })
    this.bindCrosshairBridge()
    this.emitInfo()
    // SSR 未提供基本面（上游超时/失败）时客户端补拉
    if (this.options.initialQuote == null) {
      void this.refreshQuote(this.options.symbol)
    }
  }

  destroy(): void {
    this.destroyed = true
    for (const dispose of this.disposers) {
      dispose()
    }
    this.disposers.length = 0
    if (this.klinechartsModule != null && this.chart != null) {
      this.klinechartsModule.dispose(this.options.container)
    }
    this.chart = null
    resetTimeShareState()
  }

  /** 容器盒尺寸变化时重算画布布局（klinecharts 不会自动跟随容器伸缩，由钩子的 ResizeObserver 调用） */
  resize(): void {
    this.chart?.resize()
  }

  // ==================== 标的与行情 ====================

  setSymbol(symbol: { market: string; ticker: string }): void {
    this.chart?.setSymbol({ ticker: symbol.ticker, pricePrecision: 2, volumePrecision: 0, market: symbol.market })
    void this.refreshQuote(symbol)
  }

  private refreshQuote = async (symbol: { market: string; ticker: string }): Promise<void> => {
    const quote = await fetchQuoteSnapshot(symbolCode(symbol))
    if (quote == null || this.destroyed) {
      // 拉取完成（含失败，失败时指标显示 --）后仍整体刷新信息表格
      this.emitInfo()
      return
    }
    this.latestFundamental = quote.fundamental
    this.options.onQuoteArrived?.(quote)
    this.emitInfo()
  }

  // ==================== A 股配色与 tooltip ====================

  private applyCnColorScheme = (): void => {
    // klinecharts 默认为美股式绿涨红跌（按今开比较），不符合 A 股习惯
    this.chart?.setStyles({
      candle: {
        bar: {
          compareRule: 'previous_close',
          upColor: CN_UP_COLOR,
          downColor: CN_DOWN_COLOR,
          upBorderColor: CN_UP_COLOR,
          downBorderColor: CN_DOWN_COLOR,
          upWickColor: CN_UP_COLOR,
          downWickColor: CN_DOWN_COLOR
        },
        priceMark: {
          last: {
            upColor: CN_UP_COLOR,
            downColor: CN_DOWN_COLOR
          }
        }
      },
      indicator: {
        bars: [
          {
            upColor: CN_UP_COLOR,
            downColor: CN_DOWN_COLOR
          }
        ]
      }
    })
  }

  // 时间/开/高/低/收/量 已移至顶部 K 线信息栏，图上 tooltip 不再重复显示，
  // 仅保留 MA 均线数值（颜色与图上均线一致）。
  // 数值实时取自主图 MA 当前状态（设置弹窗改参数、分时移除 MA 时自动跟随）
  private candleTooltipLegendTemplate: CandleTooltipLegendsCustomCallback = (data): TooltipLegend[] => {
    const legends: TooltipLegend[] = []
    const chart = this.chart
    if (chart == null) {
      return legends
    }
    const ma = chart.getIndicators({ paneId: 'candle_pane', name: 'MA' })[0]
    if (ma != null && ma.calcParams.length > 0) {
      const dataIndex = data.current != null ? chart.getDataList().indexOf(data.current) : -1
      const row = (ma.result[dataIndex] ?? {}) as Record<string, number>
      const lineStyles = chart.getStyles().indicator.lines
      const thousands = chart.getThousandsSeparator()
      const decimalFold = chart.getDecimalFold()
      ma.figures.forEach((figure, i) => {
        const color = lineStyles[i % lineStyles.length]?.color ?? ''
        const value = row[figure.key]
        const text = Number.isFinite(value)
          ? decimalFold.format(thousands.format(value.toFixed(ma_precision(ma.precision))))
          : 'n/a'
        legends.push({
          title: { text: figure.title ?? '', color },
          value: { text, color }
        })
      })
    }
    return legends
  }

  private applyTooltipStyles = (): void => {
    this.chart?.setStyles({
      candle: {
        tooltip: {
          // 隐藏首行「股票代码 · 周期」标题行
          title: { show: false },
          legend: {
            template: this.candleTooltipLegendTemplate
          }
        }
      }
    })
  }

  // ==================== 指标 ====================

  toggleMainIndicator = (name: string, on: boolean): void => {
    if (on) {
      this.chart?.createIndicator({ name, paneId: 'candle_pane' }, true)
    } else {
      this.chart?.removeIndicator({ name, paneId: 'candle_pane' })
    }
  }

  toggleSubIndicator = (name: string, on: boolean): void => {
    if (on) {
      this.chart?.createIndicator({ name })
    } else {
      this.chart?.removeIndicator({ name })
    }
  }

  getIndicatorSnapshot = (): Array<{ name: string; paneId: string; calcParams: number[] }> =>
    (this.chart?.getIndicators() ?? []).map((indicator) => ({
      name: indicator.name,
      paneId: indicator.paneId,
      calcParams: (indicator.calcParams ?? []).map((p) => Number(p))
    }))

  overrideIndicatorParams = (paneId: string, name: string, calcParams: number[]): void => {
    this.chart?.overrideIndicator({ paneId, name, calcParams })
  }

  // ==================== 周期与分时 ====================

  applyPeriodKey = (key: PeriodKey): void => {
    if (key === 'time') {
      this.activateTimeShare()
      return
    }
    const option = findPeriodOption(key)
    if (option == null) {
      return
    }
    const nextPeriod: Period = { span: option.span, type: option.type }
    if (timeShareState.active) {
      this.deactivateTimeShare(nextPeriod)
    } else {
      this.chart?.setPeriod(nextPeriod)
    }
  }

  private identityAxisRange: AxisCreateRangeCallback = ({ defaultRange }) => defaultRange
  private timeShareAxisRange: AxisCreateRangeCallback = ({ defaultRange }) =>
    // 以昨收为中心对称化，基准线位于面板中线
    symmetricRangeAround(timeShareState.prevClose, defaultRange)

  private applyTimeShareStyles = (): void => {
    // 主图切为面积走势线，隐藏高低点标记
    this.chart?.setStyles({
      candle: {
        type: 'area',
        priceMark: { high: { show: false }, low: { show: false } }
      }
    })
  }

  private restoreCandleStyles = (): void => {
    this.chart?.setStyles({
      candle: {
        type: 'candle_solid',
        priceMark: { high: { show: true }, low: { show: true } }
      }
    })
  }

  // 分时全天一屏：按全天 242 分钟定 bar 宽，未交易时段在右侧留白，
  // 已交易 bar 从左侧 09:30 起铺开，锚点位置全天恒定
  private calibrateTimeShareFit = (dataCount: number): void => {
    const chart = this.chart
    if (chart == null) {
      return
    }
    // 逐轮校准：设置 barSpace 后 y 轴宽度可能随刻度文本变化，内容宽随之
    // 改变，需要用稳定后的画布宽重新计算，直到收敛，保证 242 根恰好铺满
    // 内容区，首尾无空隙也无滚动裁切
    let prevWidth = -1
    for (let i = 0; i < 3; i++) {
      chart.resize()
      const canvas = chart.getDom('candle_pane', 'main')?.querySelector('canvas')
      const width = canvas?.getBoundingClientRect().width ?? 0
      if (width <= 0 || width === prevWidth) {
        break
      }
      prevWidth = width
      const space = width / TIME_SHARE_TOTAL_BARS
      if (space < 1) {
        // 低于 barSpaceLimit 下限，保持默认由用户滚动查看
        break
      }
      chart.setBarSpace(space)
      chart.setOffsetRightDistance(Math.max(0, Math.round((TIME_SHARE_TOTAL_BARS - dataCount) * space)))
    }
    // setOffsetRightDistance 不触发布局，补一次全量布局生效
    chart.resize()
  }

  private calibrateTimers: ReturnType<typeof setTimeout>[] = []

  private fitTimeShareBars = (dataCount: number): void => {
    if (dataCount <= 0) {
      return
    }
    // 兜底：轮询始终无更新时也能完成一次复校
    const timer = setTimeout(() => {
      this.calibrateTimeShareFit(dataCount)
    }, 1500)
    this.calibrateTimers.push(timer)
  }

  // 分时 x 轴：A 股交易时段锚点（默认 tick 估算按日期文本宽度，标签会落在 10:46 之类的任意分钟）
  private coordinateOfDataIndex = (dataIndex: number): number | null => {
    const point = this.chart?.convertToPixel({ dataIndex })
    const x = Array.isArray(point) ? point[0]?.x : point?.x
    return typeof x === 'number' ? x : null
  }

  private timeShareXTicks: AxisCreateTicksCallback = ({ range, bounding, defaultTicks }) => {
    const chart = this.chart
    const dataList = chart?.getDataList() ?? []
    const dayKey = timeShareState.dayKey
    if (dataList.length === 0 || dayKey == null) {
      return defaultTicks
    }
    // 数据自 09:30 起铺开时锚点位置全天恒定，未到时段（如午休时的 14:00/15:00）
    // 也按固定下标渲染在右侧留白；否则（停牌复牌等缺失早盘的日线）退回只标注已有 bar
    const openTimestamp = parseCnBarTime(`${dayKey}0930`)
    const fullDayLayout = Number.isFinite(openTimestamp) && dataList[0]?.timestamp === openTimestamp
    // 窄屏只保留首、午休、尾三个锚点
    const anchors =
      bounding.width < 360
        ? TIME_SHARE_X_ANCHORS.filter((a) => a.hhmm === '0930' || a.mergeNoon === true || a.hhmm === '1500')
        : TIME_SHARE_X_ANCHORS
    const ticks: AxisTick[] = []
    for (const anchor of anchors) {
      const timestamp = parseCnBarTime(`${dayKey}${anchor.hhmm}`)
      if (!Number.isFinite(timestamp)) {
        continue
      }
      const dataIndex = dataList.findIndex((bar) => bar.timestamp === timestamp)
      if (dataIndex < 0 && !fullDayLayout) {
        continue
      }
      // 直接以固定下标换算像素：mergeNoon 取 1130/1300 两根相邻 bar 的交界（+0.5）
      let index = dataIndex >= 0 ? dataIndex : timeShareAnchorIndex(anchor.hhmm)
      if (anchor.mergeNoon === true) {
        index += 0.5
      }
      if (index < range.realFrom - 1 || index > range.realTo) {
        continue
      }
      let coord = this.coordinateOfDataIndex(index)
      if (coord == null) {
        continue
      }
      // 首尾标签向内收缩约半字宽，避免被画布边缘裁剪
      coord = Math.min(Math.max(coord, 17), bounding.width - 17)
      ticks.push({ coord, value: timestamp, text: anchor.text })
    }
    return ticks
  }

  private defaultXTicks: AxisCreateTicksCallback = ({ defaultTicks }) => defaultTicks

  // 分时形态整体切换：在 init 数据就绪后与数据注入同帧执行，
  // 旧图（原周期 K 线）保持显示直至此刻被一次重绘替换，无白屏也无中间形态
  private applyTimeShareTransforms = (): void => {
    const chart = this.chart
    if (chart == null) {
      return
    }
    chart.removeIndicator({ name: 'MA', paneId: 'candle_pane' })
    chart.createIndicator({ name: 'TIME', paneId: 'candle_pane' }, true)
    // 跨交易日重载时形态已就位，避免重复创建百分比轴
    if (this.percentAxisId == null) {
      this.percentAxisId = chart.createYAxis({ paneId: 'candle_pane', position: 'left', name: PERCENT_Y_AXIS_NAME })
    }
    chart.overrideYAxis({ paneId: 'candle_pane', createRange: this.timeShareAxisRange, gap: TIME_SHARE_AXIS_GAP })
    chart.overrideXAxis({ createTicks: this.timeShareXTicks })
    this.applyTimeShareStyles()
  }

  private activateTimeShare = (): void => {
    timeShareState.active = true
    // 仅切换周期触发数据加载；指标/坐标轴/样式等形态变更延迟到数据就绪后
    // 与注入同帧应用，加载期间旧图原样保留（与普通周期切换行为一致）
    this.chart?.setPeriod({ span: 1, type: 'minute' })
  }

  private deactivateTimeShare = (nextPeriod: Period | null): void => {
    timeShareState.active = false
    timeShareState.dayKey = null
    timeShareState.prevClose = Number.NaN
    timeShareState.lotSize = 100
    timeShareState.isIndex = false
    for (const timer of this.calibrateTimers) {
      clearTimeout(timer)
    }
    this.calibrateTimers = []
    this.chart?.removeIndicator({ name: 'TIME', paneId: 'candle_pane' })
    if (this.percentAxisId != null && this.chart != null) {
      this.chart.removeYAxis({ id: this.percentAxisId })
      this.percentAxisId = null
    }
    this.chart?.overrideYAxis({ paneId: 'candle_pane', createRange: this.identityAxisRange, gap: DEFAULT_AXIS_GAP })
    this.chart?.overrideXAxis({ createTicks: this.defaultXTicks })
    this.restoreCandleStyles()
    this.chart?.createIndicator({ name: 'MA', paneId: 'candle_pane' }, true)
    if (nextPeriod != null) {
      this.chart?.setPeriod(nextPeriod)
    }
  }

  // ==================== 鼠标 K 线选择（右键切换） ====================

  // 开启：klinecharts 默认效果，十字光标 + tooltip 跟随鼠标
  // 关闭：无十字光标，tooltip 固定显示最后一根
  private setMouseSelect = (enabled: boolean) => {
    this.mouseSelectEnabled = enabled
    this.chart?.setStyles({ crosshair: { show: enabled } })
    // 信息表格与 tooltip 行为保持一致：开启跟鼠标，关闭固定最后一根
    this.hoverBar = null
    this.emitInfo()
    if (enabled) {
      // 清除关闭期间钉住的带 paneId 的 crosshair，否则十字线残留在最后一根
      this.chart?.executeAction('onCrosshairChange', null as never)
    } else {
      // 无 x 的 crosshair 会被库归一化指向最后一根，tooltip 随之固定
      this.chart?.executeAction('onCrosshairChange', {})
    }
  }

  private bindCrosshairBridge = (): void => {
    const chart = this.chart
    if (chart == null) {
      return
    }
    // 关闭状态下鼠标移动仍会写入带 x 的 crosshair 使 tooltip 跟随，监听变化重新钉回最后一根
    chart.subscribeAction('onCrosshairChange', (data) => {
      if (!this.mouseSelectEnabled && typeof (data as { x?: number })?.x === 'number') {
        chart.executeAction('onCrosshairChange', {})
      }
    })
    // 十字光标悬停时信息栏跟随对应 K 线。
    // 注意：库派发的回调参数是原始 {x, y, paneId}，不含 K 线数据，
    // 需用 x 通过 convertFromPixel 反查 dataIndex 再取 K 线。
    chart.subscribeAction('onCrosshairChange', (data) => {
      const x = (data as { x?: number }).x
      // 关闭鼠标选择时 tooltip 钉在最后一根，信息表格保持一致
      if (!this.mouseSelectEnabled || typeof x !== 'number') {
        this.hoverBar = null
        this.emitInfo()
        return
      }
      const points = chart.convertFromPixel([{ x }]) as Array<{ dataIndex?: number }>
      const dataList = chart.getDataList()
      const index = points[0]?.dataIndex ?? -1
      this.hoverBar = index >= 0 && index < dataList.length ? dataList[index] : null
      this.emitInfo()
    })
    // 数据加载/轮询刷新/周期切换后，若未在悬停则刷新为最新一根
    chart.subscribeAction('onVisibleRangeChange', () => {
      if (this.hoverBar == null) {
        this.emitInfo()
      }
    })

    const container = this.options.container
    const onMouseLeave = () => {
      // 鼠标移出画布时库不派发 onCrosshairChange，需自行恢复显示最后一根
      this.hoverBar = null
      this.emitInfo()
    }
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      this.setMouseSelect(!this.mouseSelectEnabled)
    }
    container.addEventListener('mouseleave', onMouseLeave)
    container.addEventListener('contextmenu', onContextMenu)
    this.disposers.push(() => {
      container.removeEventListener('mouseleave', onMouseLeave)
      container.removeEventListener('contextmenu', onContextMenu)
    })
  }

  // ==================== 绘图 ====================

  startDrawing = (name: string): void => {
    if (this.activeTool === name) {
      this.stopDrawing()
      return
    }
    this.clearActiveTool()
    this.activeTool = name
    const id = this.chart?.createOverlay({
      name,
      onDrawEnd: () => {
        this.clearActiveTool()
        this.options.onDrawingEnd?.()
      }
    })
    this.drawingOverlayId = typeof id === 'string' ? id : null
  }

  stopDrawing = (): void => {
    if (this.drawingOverlayId != null) {
      this.chart?.removeOverlay({ id: this.drawingOverlayId })
    }
    this.clearActiveTool()
  }

  private clearActiveTool = (): void => {
    this.activeTool = null
    this.drawingOverlayId = null
  }

  clearDrawings = (): void => {
    this.chart?.removeOverlay()
    this.clearActiveTool()
  }

  // ==================== 主题 ====================

  setTheme = (dark: boolean): void => {
    this.chart?.setStyles(dark ? 'dark' : 'light')
    // 主题切换会整体替换样式，A 股配色与分时面积图样式需重新应用
    this.applyCnColorScheme()
    if (timeShareState.active) {
      this.applyTimeShareStyles()
    }
    // 十字光标显隐同理，随主题样式整体替换后恢复
    this.setMouseSelect(this.mouseSelectEnabled)
  }

  // ==================== 信息快照 ====================

  private emitInfo = (): void => {
    const chart = this.chart
    const period = chart?.getPeriod() ?? null
    this.options.onInfoUpdate({
      dataList: chart?.getDataList() ?? [],
      hovered: this.hoverBar,
      fundamental: this.latestFundamental,
      intraday: timeShareState.active || (period != null && !['day', 'week', 'month', 'year'].includes(period.type))
    })
  }
}

// klinecharts indicator precision 类型为 number | undefined，toFixed 需要具体数字
const ma_precision = (precision: number | undefined): number => precision ?? 2
