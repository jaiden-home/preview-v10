import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KLineData } from 'klinecharts'
import { timeShareState } from '@/lib/chart/timeshare'
import { COMPACT_AXIS_STYLES, COMPACT_AXIS_STYLES_RESTORE, MOBILE_VIEWPORT_MAX } from '@/lib/chart/constants'

// klinecharts 内部 DOM 桩：主图主区固定 400×300（0,0 起），画布宽 555
const fakeDom = vi.hoisted(() => {
  const canvas = { getBoundingClientRect: () => ({ width: 555 }) }
  return {
    root: { style: {} as Record<string, string> },
    candleMain: {
      style: {} as Record<string, string>,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 300 }),
      querySelector: () => canvas
    },
    pane: {
      style: {} as Record<string, string>,
      getBoundingClientRect: () => ({ width: 555 }),
      querySelector: () => canvas
    }
  }
})

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
  getDom: vi.fn((paneId?: string, position?: string) => {
    if (paneId === 'candle_pane' && position === 'main') {
      return fakeDom.candleMain
    }
    if (paneId == null) {
      return fakeDom.root
    }
    return fakeDom.pane
  }),
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

// jsdom 无 TouchEvent 构造器，以普通 Event 合成 touchstart（touches 由调用方给定）
const dispatchTouchStart = (target: Element, touches: Array<{ clientX: number; clientY: number }>) => {
  const event = new Event('touchstart', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: touches })
  target.dispatchEvent(event)
}

const stubJsonFetch = (payload: unknown) => {
  const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => payload }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// jsdom 视口宽默认 1024（桌面形态），按需改写模拟移动端
const stubViewportWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
}

describe('图表终端控制器', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.location.hash = ''
    vi.clearAllMocks()
    fakeDom.root.style = {}
    fakeDom.candleMain.style = {}
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

  it('移动端视口初始化：价格轴悬浮图上并应用紧凑样式', async () => {
    stubJsonFetch({})
    stubViewportWidth(375)
    try {
      await createTerminal()
      // init layout 为此后新建轴定 inside 默认
      expect(mockInit).toHaveBeenCalledWith(expect.anything(), {
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
        layout: { yAxis: { inside: true } }
      })
      // 已有轴（主图/VOL/MACD）经 override 悬浮
      expect(mockChart.overrideYAxis).toHaveBeenCalledWith({ inside: true })
      expect(mockChart.setStyles).toHaveBeenCalledWith(COMPACT_AXIS_STYLES)
    } finally {
      vi.unstubAllGlobals()
      stubViewportWidth(1024)
    }
  })

  it('桌面端视口初始化：价格轴不悬浮，显式下发默认轴样式', async () => {
    stubJsonFetch({})
    try {
      await createTerminal()
      expect(mockInit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ layout: { yAxis: { inside: false } } })
      )
      expect(mockChart.overrideYAxis).toHaveBeenCalledWith({ inside: false })
      expect(mockChart.setStyles).toHaveBeenCalledWith(COMPACT_AXIS_STYLES_RESTORE)
      expect(mockChart.setStyles).not.toHaveBeenCalledWith(COMPACT_AXIS_STYLES)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('resize 跨断点翻转价格轴悬浮形态与紧凑样式，同形态不重复下发', async () => {
    stubJsonFetch({})
    try {
      const { terminal } = await createTerminal()
      vi.clearAllMocks()
      // 桌面形态下 resize：形态未翻转，不下发命令
      terminal.resize()
      expect(mockChart.setStyles).not.toHaveBeenCalled()
      expect(mockChart.overrideYAxis).not.toHaveBeenCalled()
      // 收窄到移动端断点（含边界值 768）：悬浮 + 紧凑样式并重算布局
      stubViewportWidth(MOBILE_VIEWPORT_MAX)
      terminal.resize()
      expect(mockChart.setStyles).toHaveBeenCalledTimes(1)
      expect(mockChart.setStyles).toHaveBeenCalledWith(COMPACT_AXIS_STYLES)
      expect(mockChart.overrideYAxis).toHaveBeenCalledTimes(1)
      expect(mockChart.overrideYAxis).toHaveBeenCalledWith({ inside: true })
      expect(mockChart.resize).toHaveBeenCalled()
      // 放大回桌面：退出悬浮并还原默认轴样式
      stubViewportWidth(1200)
      terminal.resize()
      expect(mockChart.setStyles).toHaveBeenLastCalledWith(COMPACT_AXIS_STYLES_RESTORE)
      expect(mockChart.overrideYAxis).toHaveBeenLastCalledWith({ inside: false })
    } finally {
      vi.unstubAllGlobals()
      stubViewportWidth(1024)
    }
  })

  it('主题切换整体替换样式后重放紧凑价格轴', async () => {
    stubJsonFetch({})
    stubViewportWidth(375)
    try {
      const { terminal } = await createTerminal()
      vi.clearAllMocks()
      terminal.setTheme(true)
      expect(mockChart.setStyles).toHaveBeenCalledWith('dark')
      expect(mockChart.setStyles).toHaveBeenCalledWith(COMPACT_AXIS_STYLES)
      expect(mockChart.overrideYAxis).toHaveBeenCalledWith({ inside: true })
    } finally {
      vi.unstubAllGlobals()
      stubViewportWidth(1024)
    }
  })

  it('跨断点后新建轴（副图/分时百分比轴）重申悬浮形态', async () => {
    stubJsonFetch(timeShareSnapshot)
    try {
      const { terminal } = await createTerminal()
      const loader = grabLoader()
      // 桌面初始化后翻转到移动端
      stubViewportWidth(375)
      terminal.resize()
      vi.clearAllMocks()
      // 新建副图：轴按 init 默认（不悬浮）创建，随后被重申为悬浮
      terminal.toggleSubIndicator('KDJ', true)
      expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'KDJ' })
      expect(mockChart.overrideYAxis).toHaveBeenCalledWith({ inside: true })
      // 分时百分比轴同理：数据就绪后创建并重申悬浮形态
      terminal.applyPeriodKey('time')
      await loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: { ticker: '600519', pricePrecision: 2, volumePrecision: 0, market: 'sh' },
        period: { span: 1, type: 'minute' },
        callback: vi.fn()
      })
      expect(mockChart.createYAxis).toHaveBeenCalledWith({
        paneId: 'candle_pane',
        position: 'left',
        name: 'cnTimePercent'
      })
      // 百分比轴创建后先重申悬浮，再下发分时轴 range/gap（末次调用）
      expect(mockChart.overrideYAxis).toHaveBeenCalledWith({ inside: true })
      expect(mockChart.overrideYAxis).toHaveBeenLastCalledWith({
        paneId: 'candle_pane',
        createRange: expect.any(Function),
        gap: { top: 0.08, bottom: 0.08 }
      })
    } finally {
      vi.unstubAllGlobals()
      stubViewportWidth(1024)
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

  it('移动端触摸穿透：容器放行纵向滚动，主图主区保持完全接管', async () => {
    stubJsonFetch({})
    try {
      await createTerminal()
      expect(fakeDom.root.style.touchAction).toBe('pan-y')
      // overflow:hidden 会使根容器成为触点最近的滚动容器，纵向平移无法链到页面滚动容器
      expect(fakeDom.root.style.overflow).toBe('visible')
      expect(fakeDom.candleMain.style.touchAction).toBe('none')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('副指标等区域触摸被拦截不下发图表，主图主区放行', async () => {
    stubJsonFetch({})
    try {
      const { container } = await createTerminal()
      // 模拟 klinecharts 在内部子容器上的触摸监听
      const chartInner = document.createElement('div')
      container.appendChild(chartInner)
      const touchSpy = vi.fn()
      chartInner.addEventListener('touchstart', touchSpy)
      // 落点在主图主区（400×300）之外 → capture 拦截，监听不触发
      dispatchTouchStart(chartInner, [{ clientX: 200, clientY: 400 }])
      expect(touchSpy).not.toHaveBeenCalled()
      // 多指中任一触点在主区外（副指标上双指缩放）同样拦截
      dispatchTouchStart(chartInner, [
        { clientX: 200, clientY: 150 },
        { clientX: 200, clientY: 350 }
      ])
      expect(touchSpy).not.toHaveBeenCalled()
      // 主图主区内（含双指均在主区）正常放行
      dispatchTouchStart(chartInner, [{ clientX: 200, clientY: 150 }])
      dispatchTouchStart(chartInner, [
        { clientX: 100, clientY: 50 },
        { clientX: 300, clientY: 250 }
      ])
      expect(touchSpy).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('destroy 后解除触摸拦截', async () => {
    stubJsonFetch({})
    try {
      const { terminal, container } = await createTerminal()
      const chartInner = document.createElement('div')
      container.appendChild(chartInner)
      const touchSpy = vi.fn()
      chartInner.addEventListener('touchstart', touchSpy)
      terminal.destroy()
      dispatchTouchStart(chartInner, [{ clientX: 200, clientY: 400 }])
      expect(touchSpy).toHaveBeenCalledTimes(1)
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
