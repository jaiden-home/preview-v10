import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KLineData } from 'klinecharts'
import { timeShareState } from '@/lib/chart/timeshare'

const mockChart = vi.hoisted(() => ({
  setDataLoader: vi.fn(),
  setSymbol: vi.fn(),
  setPeriod: vi.fn(),
  createIndicator: vi.fn(() => 'indicator_pane_x'),
  removeIndicator: vi.fn(() => true),
  getIndicators: vi.fn((): Array<{ name: string; paneId: string; calcParams: unknown[] }> => []),
  overrideIndicator: vi.fn(() => true),
  createOverlay: vi.fn(() => 'overlay_x'),
  removeOverlay: vi.fn(() => true),
  setStyles: vi.fn(),
  subscribeAction: vi.fn(),
  executeAction: vi.fn(),
  createYAxis: vi.fn(() => 'y_axis_x'),
  removeYAxis: vi.fn(() => true),
  overrideYAxis: vi.fn(),
  overrideXAxis: vi.fn(),
  getDom: vi.fn(() => ({
    getBoundingClientRect: () => ({ width: 555 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ width: 555 }) })
  })),
  setBarSpace: vi.fn(),
  setOffsetRightDistance: vi.fn(),
  resize: vi.fn(),
  getDataList: vi.fn((): unknown[] => []),
  convertToPixel: vi.fn(() => ({ x: 100 })),
  getPeriod: vi.fn(() => ({ span: 1, type: 'day' })),
  getThousandsSeparator: vi.fn(() => ({ format: (v: string) => v })),
  getDecimalFold: vi.fn(() => ({ format: (v: string) => v }))
}))

const mockDispose = vi.hoisted(() => vi.fn())
const mockInit = vi.hoisted(() => vi.fn(() => mockChart))

vi.mock('klinecharts', () => ({
  init: mockInit,
  dispose: mockDispose,
  registerIndicator: vi.fn(),
  registerYAxis: vi.fn()
}))

const { ChartTerminal } = await import('@/lib/chart/terminal')

const defaultIndicators = () => [
  { name: 'MA', paneId: 'candle_pane', calcParams: [5, 10, 30, 60] },
  { name: 'VOL', paneId: 'indicator_pane_1', calcParams: [5, 10] },
  { name: 'MACD', paneId: 'indicator_pane_2', calcParams: [12, 26, 9] }
]

// BFF 分时快照：最新交易日 2 根有效分钟点
const timeShareSnapshot = {
  date: '20260914',
  prevClose: 1275.16,
  bars: [
    {
      timestamp: new Date('2026-09-14T09:30').getTime(),
      open: 1275.16,
      high: 1277.27,
      low: 1277.27,
      close: 1277.27,
      volume: 133
    },
    {
      timestamp: new Date('2026-09-14T09:31').getTime(),
      open: 1277.27,
      high: 1283.89,
      low: 1283.89,
      close: 1283.89,
      volume: 556
    }
  ] as KLineData[]
}

const createTerminal = async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const terminal = new ChartTerminal({
    container,
    symbol: { market: 'sh', ticker: '600519' },
    initialBars: null,
    initialQuote: null,
    locale: 'zh-CN',
    onInfoUpdate: vi.fn(),
    onDrawingEnd: vi.fn()
  })
  await terminal.init()
  return { terminal, container }
}

const grabLoader = () => mockChart.setDataLoader.mock.calls[0][0]

const stubJsonFetch = (payload: unknown) => {
  const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => payload }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('图表终端控制器', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.location.hash = ''
    vi.clearAllMocks()
    mockChart.getIndicators.mockReturnValue(defaultIndicators())
    timeShareState.active = false
    timeShareState.prevClose = Number.NaN
    timeShareState.dayKey = null
    timeShareState.lotSize = 100
    timeShareState.isIndex = false
  })

  it('初始化时主图指标叠加在 candle_pane，副图指标创建独立窗口', async () => {
    stubJsonFetch({ name: '贵州茅台' })
    try {
      await createTerminal()
      expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'MA', paneId: 'candle_pane' }, true)
      expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'VOL' })
      expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'MACD' })
      expect(mockChart.setPeriod).toHaveBeenCalledWith({ span: 1, type: 'day' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('初始化应用 A 股配色：红涨绿跌并按昨收判定', async () => {
    stubJsonFetch({})
    try {
      await createTerminal()
      expect(mockChart.setStyles).toHaveBeenCalledWith(
        expect.objectContaining({
          candle: expect.objectContaining({
            bar: expect.objectContaining({
              compareRule: 'previous_close',
              upColor: '#ef2323',
              downColor: '#14a143'
            }),
            priceMark: expect.objectContaining({
              last: expect.objectContaining({ upColor: '#ef2323', downColor: '#14a143' })
            })
          }),
          indicator: expect.objectContaining({
            bars: [expect.objectContaining({ upColor: '#ef2323', downColor: '#14a143' })]
          })
        })
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('切换「分时」仅切周期，形态延迟到数据就绪同帧应用', async () => {
    stubJsonFetch({})
    try {
      const { terminal } = await createTerminal()
      terminal.applyPeriodKey('time')
      expect(mockChart.setPeriod).toHaveBeenCalledWith({ span: 1, type: 'minute' })
      expect(timeShareState.active).toBe(true)
      // 加载期间旧图保持显示：不做任何形态变更，避免中间形态闪屏
      expect(mockChart.removeIndicator).not.toHaveBeenCalled()
      expect(mockChart.createYAxis).not.toHaveBeenCalled()
      expect(mockChart.setStyles).not.toHaveBeenCalledWith({
        candle: {
          type: 'area',
          priceMark: { high: { show: false }, low: { show: false } }
        }
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('分时加载官方数据后全天一屏适配', async () => {
    const fetchMock = stubJsonFetch(timeShareSnapshot)
    try {
      await createTerminal()
      // init 期间 setSymbol 会发起 /api/quote 请求，清除后再统计分时请求
      fetchMock.mockClear()
      const loader = grabLoader()
      const callback = vi.fn()
      timeShareState.active = true
      await loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: { ticker: '600519', pricePrecision: 2, volumePrecision: 0, market: 'sh' },
        period: { span: 1, type: 'minute' },
        callback
      })
      // 仅保留 0930/0931 两根有效点，昨收取自接口；当日全量加载后无更多数据
      expect(callback).toHaveBeenCalledWith(
        [
          expect.objectContaining({ close: 1277.27, volume: 133 }),
          expect.objectContaining({ close: 1283.89, volume: 556 })
        ],
        false
      )
      expect(timeShareState.dayKey).toBe('20260914')
      expect(timeShareState.prevClose).toBe(1275.16)
      // 数据就绪后同帧应用分时形态：移除主图指标、挂均价指标、百分比左轴与面积图
      expect(mockChart.removeIndicator).toHaveBeenCalledWith({ name: 'MA', paneId: 'candle_pane' })
      expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'TIME', paneId: 'candle_pane' }, true)
      expect(mockChart.createYAxis).toHaveBeenCalledWith({
        paneId: 'candle_pane',
        position: 'left',
        name: 'cnTimePercent'
      })
      expect(mockChart.setStyles).toHaveBeenCalledWith({
        candle: {
          type: 'area',
          priceMark: { high: { show: false }, low: { show: false } }
        }
      })
      // 同帧完成全天一屏校准，不等轮询首次更新
      expect(mockChart.setBarSpace).toHaveBeenCalledWith(555 / 242)
      expect(mockChart.setOffsetRightDistance).toHaveBeenCalledWith(Math.round((242 - 2) * (555 / 242)))
      // 请求落在 BFF 分时口
      expect(fetchMock.mock.calls[0][0]).toContain('/api/timeshare?symbol=sh600519')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('分时下切回 5 分周期：移除分时组件并恢复蜡烛样式与主图指标', async () => {
    stubJsonFetch(timeShareSnapshot)
    try {
      const { terminal } = await createTerminal()
      terminal.applyPeriodKey('time')
      const loader = grabLoader()
      timeShareState.active = true
      await loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: { ticker: '600519', pricePrecision: 2, volumePrecision: 0, market: 'sh' },
        period: { span: 1, type: 'minute' },
        callback: vi.fn()
      })
      vi.clearAllMocks()
      terminal.applyPeriodKey('5m')
      expect(mockChart.removeIndicator).toHaveBeenCalledWith({ name: 'TIME', paneId: 'candle_pane' })
      expect(mockChart.removeYAxis).toHaveBeenCalledWith({ id: 'y_axis_x' })
      expect(mockChart.overrideYAxis).toHaveBeenCalledWith(
        expect.objectContaining({
          gap: { top: 0.2, bottom: 0.1 }
        })
      )
      // 退出分时恢复默认 x 轴
      expect(mockChart.overrideXAxis).toHaveBeenCalledWith(
        expect.objectContaining({ createTicks: expect.any(Function) })
      )
      expect(mockChart.setStyles).toHaveBeenCalledWith({
        candle: {
          type: 'candle_solid',
          priceMark: { high: { show: true }, low: { show: true } }
        }
      })
      expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'MA', paneId: 'candle_pane' }, true)
      expect(mockChart.setPeriod).toHaveBeenCalledWith({ span: 5, type: 'minute' })
      expect(timeShareState.active).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('主题切换在分时激活时重新应用面积图样式', async () => {
    stubJsonFetch({})
    try {
      const { terminal } = await createTerminal()
      terminal.applyPeriodKey('time')
      vi.clearAllMocks()
      terminal.setTheme(true)
      expect(mockChart.setStyles).toHaveBeenCalledWith('dark')
      expect(mockChart.setStyles).toHaveBeenCalledWith({
        candle: {
          type: 'area',
          priceMark: { high: { show: false }, low: { show: false } }
        }
      })
      // A 股配色在主题切换后重新应用
      expect(mockChart.setStyles).toHaveBeenCalledWith(
        expect.objectContaining({
          candle: expect.objectContaining({
            bar: expect.objectContaining({ compareRule: 'previous_close' })
          })
        })
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('右键图表关闭：隐藏十字光标并将 crosshair 钉到最后一根（tooltip 固定）', async () => {
    stubJsonFetch({})
    try {
      const { container } = await createTerminal()
      container.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true, bubbles: true }))
      expect(mockChart.setStyles).toHaveBeenCalledWith({ crosshair: { show: false } })
      expect(mockChart.executeAction).toHaveBeenCalledWith('onCrosshairChange', {})
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('再次右键恢复默认：重新显示十字光标并清除钉住的 crosshair', async () => {
    stubJsonFetch({})
    try {
      const { container } = await createTerminal()
      container.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true, bubbles: true }))
      container.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true, bubbles: true }))
      expect(mockChart.setStyles).toHaveBeenCalledWith({ crosshair: { show: true } })
      expect(mockChart.executeAction).toHaveBeenLastCalledWith('onCrosshairChange', null)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('关闭状态下鼠标移动的 crosshair 会被重新钉回最后一根', async () => {
    stubJsonFetch({})
    try {
      const { container } = await createTerminal()
      container.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true, bubbles: true }))
      const subscription = mockChart.subscribeAction.mock.calls.find(([type]) => type === 'onCrosshairChange') as [
        string,
        (data: unknown) => void
      ]
      expect(subscription).toBeTruthy()
      subscription[1]({ x: 100, y: 50, paneId: 'candle_pane' })
      expect(mockChart.executeAction).toHaveBeenLastCalledWith('onCrosshairChange', {})
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('开启状态下鼠标移动不干预 crosshair', async () => {
    stubJsonFetch({})
    try {
      await createTerminal()
      const subscription = mockChart.subscribeAction.mock.calls.find(([type]) => type === 'onCrosshairChange') as [
        string,
        (data: unknown) => void
      ]
      mockChart.executeAction.mockClear()
      subscription[1]({ x: 100, y: 50, paneId: 'candle_pane' })
      expect(mockChart.executeAction).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('destroy 后释放图表且不再响应命令', async () => {
    stubJsonFetch({})
    try {
      const { terminal } = await createTerminal()
      terminal.destroy()
      expect(mockDispose).toHaveBeenCalled()
      vi.clearAllMocks()
      terminal.setTheme(true)
      expect(mockChart.setStyles).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
