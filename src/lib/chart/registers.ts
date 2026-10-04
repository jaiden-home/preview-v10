import type { AxisCreateRangeCallback, AxisCreateTicksCallback, AxisTick, KLineData } from 'klinecharts'
import type { Locale } from '../i18n'
import { PERCENT_Y_AXIS_NAME } from './constants'
import { shadowStubRects } from './min-shadow'
import { SIGNAL_BADGE_FONT, SIGNAL_TEXT_COLOR, signalColorOf, signalMarkerOf, simSignalState } from './sim-signal'
import { calcTimeShareAvg, percentOfPrevClose, priceOfPercent, timeShareState, type TimeShareDatum } from './timeshare'

/**
 * 注册自定义指标与坐标轴（幂等，重复注册按 klinecharts 语义覆盖）。
 * 必须在客户端图表初始化前调用；shortName/title 按注册时 locale 固化，
 * 与原 SPA 行为一致（切换语言需重载页面）。
 *
 * 注意：klinecharts 在模块顶层访问 window（Canvas 库不支持 Node 环境），
 * 这里必须动态导入，确保 klinecharts 不进入服务端渲染模块图。
 */
export const setupChartRegisters = async (locale: Locale): Promise<void> => {
  const { registerIndicator, registerYAxis } = await import('klinecharts')
  const isEn = locale === 'en-US'

  // 左侧涨跌幅轴：价格 <-> 昨收百分比
  registerYAxis({
    name: PERCENT_Y_AXIS_NAME,
    realValueToDisplayValue: percentOfPrevClose,
    displayValueToRealValue: priceOfPercent,
    displayValueToText: (value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
  })

  // 分时均价指标（挂主图），draw 里额外绘制昨收基准虚线
  registerIndicator<TimeShareDatum>({
    name: 'TIME',
    shortName: isEn ? 'Time' : '分时',
    series: 'price',
    calcParams: [],
    figures: [
      {
        key: 'avg',
        type: 'line',
        title: isEn ? 'Avg: ' : '均价: ',
        styles: () => ({ color: '#F5A623', size: 1 })
      }
    ],
    calc: calcTimeShareAvg,
    draw: ({ ctx, chart, bounding, yAxis }) => {
      const prevClose = timeShareState.prevClose
      if (!Number.isFinite(prevClose) || prevClose <= 0) {
        return false
      }
      const y = yAxis.convertToPixel(prevClose)
      if (!Number.isFinite(y)) {
        return false
      }
      ctx.save()
      ctx.strokeStyle = chart.getStyles().grid.horizontal.color
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(bounding.left, y)
      ctx.lineTo(bounding.right, y)
      ctx.stroke()
      ctx.restore()
      return false
    }
  })

  // 亚像素影线补画（挂主图）：真实影线像素长度不足时从实体边缘向外补一段最小可见竖线，
  // 「有价差就至少看得见 1px」。仅 K 线模式存在（分时切换由 ChartTerminal 移除/重建），
  // 不出图例不出 tooltip（见 createTooltipDataSource 空图例，与 MA 覆盖一致）
  registerIndicator<Record<string, never>>({
    name: 'MIN_SHADOW',
    shortName: '',
    series: 'price',
    calcParams: [],
    figures: [],
    calc: (dataList: KLineData[]) => dataList.map(() => ({})),
    createTooltipDataSource: () => ({
      name: '',
      calcParamsText: '',
      features: [],
      legends: []
    }),
    draw: ({ ctx, chart, xAxis, yAxis }) => {
      const dataList = chart.getDataList()
      const { from, to } = chart.getVisibleRange()
      ctx.save()
      for (let i = from; i < to; i++) {
        const bar = dataList[i]
        if (bar == null) {
          continue
        }
        const x = xAxis.convertTimestampToPixel(bar.timestamp)
        for (const rect of shadowStubRects(bar, (price) => yAxis.convertToPixel(price), x)) {
          ctx.fillStyle = rect.color
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
        }
      }
      ctx.restore()
      return false
    }
  })

  // 极速模拟买卖点徽记（挂主图）：对信号日 K 线柱低点下方（买 B）/高点上方（卖 S）
  // 绘制语义色圆形徽记（买 = --up 红实底、卖 = --tb-active 蓝实底、白字 --on-solid）。
  // 信号点经 ChartTerminal.setSimSignals 写入模块态（仅 /simtrade 注入，其余页空态零绘制）；
  // 仅日周期渲染（周/月聚合柱时间戳与信号日不对应，避免错位）；
  // 不出图例不出 tooltip（与 MIN_SHADOW 同范式）
  registerIndicator<Record<string, never>>({
    name: 'SIM_SIGNAL',
    shortName: '',
    series: 'price',
    calcParams: [],
    figures: [],
    calc: (dataList: KLineData[]) => dataList.map(() => ({})),
    createTooltipDataSource: () => ({
      name: '',
      calcParamsText: '',
      features: [],
      legends: []
    }),
    draw: ({ ctx, chart, xAxis, yAxis }) => {
      const { points, dark } = simSignalState
      if (points.size === 0) {
        return false
      }
      const period = chart.getPeriod()
      if (period == null || period.type !== 'day') {
        return false
      }
      const dataList = chart.getDataList()
      const { from, to } = chart.getVisibleRange()
      ctx.save()
      ctx.font = SIGNAL_BADGE_FONT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = from; i < to; i++) {
        const bar = dataList[i]
        if (bar == null) {
          continue
        }
        const side = points.get(bar.timestamp)
        if (side == null) {
          continue
        }
        const x = xAxis.convertTimestampToPixel(bar.timestamp)
        const marker = signalMarkerOf(bar, side, (price) => yAxis.convertToPixel(price), x)
        ctx.beginPath()
        ctx.arc(marker.x, marker.y, marker.r, 0, Math.PI * 2)
        ctx.fillStyle = signalColorOf(marker.side, dark)
        ctx.fill()
        ctx.fillStyle = SIGNAL_TEXT_COLOR
        ctx.fillText(marker.text, marker.x, marker.y + 0.5)
      }
      ctx.restore()
      return false
    }
  })

  // 覆盖内置 MA：tooltip 不再单独渲染（名称行与数值行均并入首行，
  // 见 candle tooltip 模板），calc/figures 逻辑与库内置保持一致
  registerIndicator<Record<string, number>, number>({
    name: 'MA',
    shortName: 'MA',
    series: 'price',
    calcParams: [3, 5, 10, 30, 60],
    precision: 2,
    shouldOhlc: true,
    regenerateFigures: (params) =>
      params.map((p, i) => ({
        key: `ma${i + 1}`,
        title: `MA${p}: `,
        type: 'line'
      })),
    calc: (dataList: KLineData[], indicator) => {
      const closeSums: number[] = []
      return dataList.map((kLineData, i) => {
        const ma: Record<string, number> = {}
        const close = kLineData.close
        indicator.calcParams.forEach((p, index) => {
          closeSums[index] = (closeSums[index] ?? 0) + close
          if (i >= p - 1) {
            ma[indicator.figures[index].key] = closeSums[index] / p
            closeSums[index] -= dataList[i - (p - 1)].close
          }
        })
        return ma
      })
    },
    createTooltipDataSource: () => ({
      name: '',
      calcParamsText: '',
      features: [],
      // 空数组：MA 名称与数值全部由 candle tooltip 模板并入首行，指标自身不再出图例
      legends: []
    })
  })

  // 换手率指标：成交量 / 流通股本 * 100%（需流通股本数据，暂用成交量近似）
  registerIndicator<Record<string, number>>({
    name: 'TURNOVER',
    shortName: isEn ? 'Turnover' : '换手率',
    series: 'volume',
    calcParams: [],
    precision: 2,
    shouldFormatBigNumber: false,
    figures: [
      {
        key: 'turnoverRate',
        title: isEn ? 'Turnover Rate: ' : '换手率: ',
        type: 'bar',
        baseValue: 0,
        styles: () => ({ color: '#9B59B6' })
      }
    ],
    calc: (dataList: KLineData[]) => {
      // 简化计算：使用相对换手率（实际应用中需传入流通股本）
      const maxVolume = Math.max(...dataList.map((d) => d.volume ?? 0), 1)
      return dataList.map((bar) => ({
        turnoverRate: ((bar.volume ?? 0) / maxVolume) * 100
      }))
    }
  })

  // 振幅指标：(最高价 - 最低价) / 昨收价 * 100%
  registerIndicator<Record<string, number>>({
    name: 'AMPLITUDE',
    shortName: isEn ? 'Amplitude' : '振幅',
    series: 'volume',
    calcParams: [],
    precision: 2,
    shouldFormatBigNumber: false,
    figures: [
      {
        key: 'amplitude',
        title: isEn ? 'Amplitude: ' : '振幅: ',
        type: 'bar',
        baseValue: 0,
        styles: () => ({ color: '#E67E22' })
      }
    ],
    calc: (dataList: KLineData[]) => {
      return dataList.map((bar, i) => {
        const prevClose = i > 0 ? dataList[i - 1].close : bar.open
        const high = bar.high ?? bar.close
        const low = bar.low ?? bar.close
        const amplitude = prevClose > 0 ? ((high - low) / prevClose) * 100 : 0
        return { amplitude }
      })
    }
  })
}

// 以下两个类型供图表控制器 override 坐标轴时复用签名
export type { AxisCreateRangeCallback, AxisCreateTicksCallback, AxisTick }
