import { beforeEach, describe, expect, it, vi } from 'vitest'
import setupApp, {
  aggregateBars,
  calcTimeShareAvg,
  cnPeriodKey,
  guessCnMarket,
  isCnIndex,
  isCnStarMarket,
  localDayKey,
  parseCnBarTime,
  parseTimeShareDay,
  parseTencentKlines,
  pickPrevClose,
  symmetricRangeAround,
  timeShareState
} from './app'
import type { AxisRange, KLineData } from 'klinecharts'

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
  setTimezone: vi.fn(),
  setStyles: vi.fn(),
  subscribeAction: vi.fn(),
  executeAction: vi.fn(),
  createYAxis: vi.fn(() => 'y_axis_x'),
  removeYAxis: vi.fn(() => true),
  overrideYAxis: vi.fn(),
  overrideXAxis: vi.fn(),
  getSize: vi.fn(() => ({ width: 555, height: 268, left: 57, right: 612, top: 95, bottom: 363 })),
  getDom: vi.fn(() => ({ getBoundingClientRect: () => ({ width: 555 }), querySelector: () => ({ getBoundingClientRect: () => ({ width: 555 }) }) })),
  setBarSpace: vi.fn(),
  setOffsetRightDistance: vi.fn(),
  resize: vi.fn(),
  getDataList: vi.fn((): unknown[] => []),
  convertToPixel: vi.fn(() => ({ x: 100 }))
}))

vi.mock('klinecharts', () => ({
  init: vi.fn(() => mockChart),
  registerIndicator: vi.fn(),
  registerYAxis: vi.fn()
}))

const defaultIndicators = () => ([
  { name: 'MA', paneId: 'candle_pane', calcParams: [5, 10, 30, 60] },
  { name: 'VOL', paneId: 'indicator_pane_1', calcParams: [5, 10] },
  { name: 'MACD', paneId: 'indicator_pane_2', calcParams: [12, 26, 9] }
])

const renderApp = (): HTMLDivElement => {
  const root = document.createElement('div')
  document.body.appendChild(root)
  setupApp(root)
  return root
}

const openModal = (root: HTMLDivElement): HTMLElement => {
  root.querySelector<HTMLElement>('#indicator-setting-btn')!.click()
  return root.querySelector<HTMLElement>('#indicator-modal')!
}

const getSelect = (root: HTMLDivElement): HTMLSelectElement =>
  root.querySelector<HTMLSelectElement>('#indicator-select')!

const getParamLabels = (root: HTMLDivElement): Array<string | null> =>
  Array.from(root.querySelectorAll<HTMLElement>('#param-list .param-label')).map(el => el.textContent)

const getParamInputs = (root: HTMLDivElement): HTMLInputElement[] =>
  Array.from(root.querySelectorAll<HTMLInputElement>('#param-list .param-input'))

describe('指标参数设置弹窗', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.location.hash = ''
    vi.clearAllMocks()
    mockChart.getIndicators.mockReturnValue(defaultIndicators())
  })

  it('初始化时主图指标叠加在 candle_pane，副图指标创建独立窗口', () => {
    renderApp()
    expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'MA', paneId: 'candle_pane' }, true)
    expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'VOL' })
    expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'MACD' })
  })

  it('点击「指标设置」打开弹窗，指标列表来自 getIndicators 并标注主/副图', () => {
    const root = renderApp()
    const modal = openModal(root)
    expect(modal.classList.contains('open')).toBe(true)
    const options = Array.from(getSelect(root).options).map(o => o.textContent)
    expect(options).toEqual(['MA（主图）', 'VOL（副图）', 'MACD（副图）'])
    expect(getSelect(root).value).toBe('0')
  })

  it('默认渲染第一个指标的参数，使用元数据标签和实时值', () => {
    const root = renderApp()
    openModal(root)
    expect(getParamLabels(root)).toEqual(['MA1', 'MA2', 'MA3', 'MA4'])
    expect(getParamInputs(root).map(i => i.value)).toEqual(['5', '10', '30', '60'])
    expect(getParamInputs(root)[0].min).toBe('1')
    expect(getParamInputs(root)[0].step).toBe('1')
  })

  it('切换下拉选项后重新渲染对应指标参数', () => {
    const root = renderApp()
    openModal(root)
    const select = getSelect(root)
    select.value = '2'
    select.dispatchEvent(new Event('change'))
    expect(getParamLabels(root)).toEqual(['快线', '慢线', '信号'])
    expect(getParamInputs(root).map(i => i.value)).toEqual(['12', '26', '9'])
  })

  it('无元数据的指标回退为「参数 N」标签', () => {
    mockChart.getIndicators.mockReturnValue([
      { name: 'XYZ', paneId: 'indicator_pane_9', calcParams: [3, 7] }
    ])
    const root = renderApp()
    openModal(root)
    expect(getParamLabels(root)).toEqual(['参数 1', '参数 2'])
    expect(getParamInputs(root).map(i => i.value)).toEqual(['3', '7'])
  })

  it('BOLL 的标准差参数支持小数（step 0.01）', () => {
    mockChart.getIndicators.mockReturnValue([
      { name: 'BOLL', paneId: 'candle_pane', calcParams: [20, 2] }
    ])
    const root = renderApp()
    openModal(root)
    const inputs = getParamInputs(root)
    expect(getParamLabels(root)).toEqual(['周期', '标准差'])
    expect(inputs[1].step).toBe('0.01')
    expect(inputs[1].min).toBe('0.1')
  })

  it('calcParams 为空的指标显示无可设置参数', () => {
    mockChart.getIndicators.mockReturnValue([
      { name: 'PVT', paneId: 'indicator_pane_1', calcParams: [] }
    ])
    const root = renderApp()
    openModal(root)
    expect(root.querySelector('#param-list')!.textContent).toContain('该指标无可设置参数')
  })

  it('当前无指标时显示「暂无指标」，点确定不调用 overrideIndicator', () => {
    mockChart.getIndicators.mockReturnValue([])
    const root = renderApp()
    const modal = openModal(root)
    expect(getSelect(root).textContent).toContain('暂无指标')
    root.querySelector<HTMLElement>('#indicator-modal-confirm')!.click()
    expect(mockChart.overrideIndicator).not.toHaveBeenCalled()
    expect(modal.classList.contains('open')).toBe(false)
  })

  it('修改参数并确认后调用 overrideIndicator 且弹窗关闭', () => {
    const root = renderApp()
    const modal = openModal(root)
    const inputs = getParamInputs(root)
    inputs[0].value = '20'
    root.querySelector<HTMLElement>('#indicator-modal-confirm')!.click()
    expect(mockChart.overrideIndicator).toHaveBeenCalledTimes(1)
    expect(mockChart.overrideIndicator).toHaveBeenCalledWith({
      paneId: 'candle_pane',
      name: 'MA',
      calcParams: [20, 10, 30, 60]
    })
    expect(modal.classList.contains('open')).toBe(false)
  })

  it('空值与低于最小值的输入会被钳制为 min', () => {
    const root = renderApp()
    openModal(root)
    const inputs = getParamInputs(root)
    inputs[0].value = ''
    inputs[1].value = '0'
    root.querySelector<HTMLElement>('#indicator-modal-confirm')!.click()
    expect(mockChart.overrideIndicator).toHaveBeenCalledWith({
      paneId: 'candle_pane',
      name: 'MA',
      calcParams: [1, 1, 30, 60]
    })
  })

  it('整数参数（step 1）输入小数会被取整，小数参数（step 0.01）保留', () => {
    const root = renderApp()
    openModal(root)
    const inputs = getParamInputs(root)
    inputs[0].value = '5.5'
    root.querySelector<HTMLElement>('#indicator-modal-confirm')!.click()
    expect(mockChart.overrideIndicator).toHaveBeenCalledWith({
      paneId: 'candle_pane',
      name: 'MA',
      calcParams: [6, 10, 30, 60]
    })

    mockChart.getIndicators.mockReturnValue([
      { name: 'BOLL', paneId: 'candle_pane', calcParams: [20, 2] }
    ])
    openModal(root)
    const bollInputs = getParamInputs(root)
    bollInputs[1].value = '2.5'
    root.querySelector<HTMLElement>('#indicator-modal-confirm')!.click()
    expect(mockChart.overrideIndicator).toHaveBeenLastCalledWith({
      paneId: 'candle_pane',
      name: 'BOLL',
      calcParams: [20, 2.5]
    })
  })

  it('重新打开弹窗时读取指标最新的 calcParams', () => {
    const root = renderApp()
    openModal(root)
    root.querySelector<HTMLElement>('#indicator-modal-confirm')!.click()
    mockChart.getIndicators.mockReturnValue([
      { name: 'MA', paneId: 'candle_pane', calcParams: [20, 10, 30, 60] }
    ])
    openModal(root)
    expect(getParamInputs(root).map(i => i.value)).toEqual(['20', '10', '30', '60'])
  })

  it('点击取消/×/遮罩/Esc 关闭弹窗且不提交', () => {
    const root = renderApp()
    const modal = openModal(root)
    root.querySelector<HTMLElement>('#indicator-modal-cancel')!.click()
    expect(modal.classList.contains('open')).toBe(false)

    openModal(root)
    root.querySelector<HTMLElement>('#indicator-modal-close')!.click()
    expect(modal.classList.contains('open')).toBe(false)

    openModal(root)
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(modal.classList.contains('open')).toBe(false)

    openModal(root)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(modal.classList.contains('open')).toBe(false)

    expect(mockChart.overrideIndicator).not.toHaveBeenCalled()
  })

  it('英文环境下弹窗使用英文文案', () => {
    window.location.hash = '#en-US'
    mockChart.getIndicators.mockReturnValue([
      { name: 'MACD', paneId: 'indicator_pane_1', calcParams: [12, 26, 9] }
    ])
    const root = renderApp()
    openModal(root)
    expect(root.querySelector<HTMLElement>('#indicator-setting-btn')!.textContent).toBe('Indicator Settings')
    expect(getSelect(root).options[0].textContent).toBe('MACD (Sub)')
    expect(getParamLabels(root)).toEqual(['Fast', 'Slow', 'Signal'])
    expect(root.querySelector<HTMLElement>('#indicator-modal-confirm')!.textContent).toBe('OK')
  })
})

describe('A股数据源纯函数', () => {
  it('parseCnBarTime 支持三种时间格式并拒绝非法值', () => {
    expect(parseCnBarTime('2026-09-14')).toBe(new Date('2026-09-14T00:00:00').getTime())
    expect(parseCnBarTime('2026-09-14 14:45')).toBe(new Date('2026-09-14T14:45').getTime())
    expect(parseCnBarTime('202609141445')).toBe(new Date('2026-09-14T14:45').getTime())
    expect(parseCnBarTime('20260914')).toBe(new Date('2026-09-14T00:00:00').getTime())
    expect(Number.isNaN(parseCnBarTime('abc'))).toBe(true)
  })

  it('parseTencentKlines 解析日K/分钟K并过滤坏行', () => {
    const rows: unknown[] = [
      ['2026-09-14', '1277.27', '1277.96', '1285.53', '1270.36', '16571'],
      ['202609141500', '1278.00', '1277.96', '1278.52', '1277.49', '1545.00', {}, '1.24'],
      ['bad-row'],
      ['abc', '1', '2', '3', '4', '5'],
      'not-an-array'
    ]
    const dataList = parseTencentKlines(rows)
    expect(dataList).toHaveLength(2)
    expect(dataList[0]).toEqual({
      timestamp: new Date('2026-09-14T00:00:00').getTime(),
      open: 1277.27,
      close: 1277.96,
      high: 1285.53,
      low: 1270.36,
      volume: 16571
    })
    expect(dataList[1].timestamp).toBe(new Date('2026-09-14T15:00').getTime())
    expect(dataList[1].volume).toBe(1545)
  })

  it('aggregateBars 按毫秒桶合并 OHLCV 且时间对齐桶起点', () => {
    const hour = 60 * 60 * 1000
    const bucketStart = Math.ceil(new Date('2026-09-14T09:00:00').getTime() / (2 * hour)) * (2 * hour)
    const dataList = [
      { timestamp: bucketStart + 15 * 60000, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { timestamp: bucketStart + 45 * 60000, open: 11, high: 15, low: 10, close: 14, volume: 200 },
      { timestamp: bucketStart + hour + 10 * 60000, open: 14, high: 16, low: 13, close: 15, volume: 300 }
    ]
    const result = aggregateBars(dataList, 2 * hour)
    expect(result).toHaveLength(1)
    expect(result[0].timestamp).toBe(bucketStart)
    expect(result[0].open).toBe(10)
    expect(result[0].high).toBe(16)
    expect(result[0].low).toBe(9)
    expect(result[0].close).toBe(15)
    expect(result[0].volume).toBe(600)
  })

  it('guessCnMarket 按代码前缀推断市场', () => {
    expect(guessCnMarket('600519')).toBe('sh')
    expect(guessCnMarket('688981')).toBe('sh')
    expect(guessCnMarket('000001')).toBe('sz')
    expect(guessCnMarket('300750')).toBe('sz')
    expect(guessCnMarket('002594')).toBe('sz')
    expect(guessCnMarket('430047')).toBe('bj')
    expect(guessCnMarket('832566')).toBe('bj')
    expect(guessCnMarket('920001')).toBe('bj')
  })

  it('cnPeriodKey 生成周期键且非标准周期返回未映射键', () => {
    expect(cnPeriodKey({ span: 15, type: 'minute' })).toBe('15m')
    expect(cnPeriodKey({ span: 1, type: 'hour' })).toBe('1h')
    expect(cnPeriodKey({ span: 1, type: 'day' })).toBe('1d')
    expect(cnPeriodKey({ span: 4, type: 'hour' })).toBe('4h')
  })
})

describe('分时图', () => {
  const clickPeriod = (root: HTMLDivElement, key: string) => {
    root.querySelector<HTMLButtonElement>(`.period-btn[data-key="${key}"]`)!.click()
  }

  const defaultSymbol = { ticker: '600519', pricePrecision: 2, volumePrecision: 0, market: 'sh' }

  // 官方分时接口返回样例：最新交易日 2 根有效分钟点，昨收 qt[4]
  const timeSharePayload = {
    data: {
      sh600519: {
        qt: { sh600519: ['1', '贵州茅台', '600519', '1277.96', '1275.16', '1277.27'] },
        data: [
          { date: '20260914', data: ['0930 1277.27 133 16987691.06', '0931 1283.89 689 88207201.15', '1530 1277.96 689 88207201.15'] },
          { date: '20260911', data: ['0930 1260.00 100 1000000.00'] }
        ]
      }
    }
  }

  // 走完分时激活的数据就绪流程（形态在同帧应用）
  const readyTimeShare = async () => {
    const loader = mockChart.setDataLoader.mock.calls[0][0]
    await loader.getBars({
      type: 'init',
      timestamp: null,
      symbol: defaultSymbol,
      period: { span: 1, type: 'minute' },
      callback: vi.fn()
    })
  }

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

  it('点击「分时」仅切换周期，形态延迟到数据就绪同帧应用', () => {
    const root = renderApp()
    clickPeriod(root, 'time')
    expect(mockChart.setPeriod).toHaveBeenCalledWith({ span: 1, type: 'minute' })
    expect(timeShareState.active).toBe(true)
    // 加载期间旧图保持显示：不做任何形态变更，避免中间形态闪屏
    expect(mockChart.removeIndicator).not.toHaveBeenCalled()
    expect(mockChart.createIndicator).not.toHaveBeenCalledWith({ name: 'TIME', paneId: 'candle_pane' }, true)
    expect(mockChart.createYAxis).not.toHaveBeenCalled()
    expect(mockChart.setStyles).not.toHaveBeenCalledWith({
      candle: {
        type: 'area',
        priceMark: { high: { show: false }, low: { show: false } }
      }
    })
  })

  it('分时下切回 5 分周期：移除分时组件并恢复蜡烛样式与主图指标', async () => {
    const root = renderApp()
    clickPeriod(root, 'time')
    const fetchMock = vi.fn(async () => ({ json: async () => timeSharePayload }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await readyTimeShare()
      vi.clearAllMocks()
      clickPeriod(root, '5m')
      expect(mockChart.removeIndicator).toHaveBeenCalledWith({ name: 'TIME', paneId: 'candle_pane' })
      expect(mockChart.removeYAxis).toHaveBeenCalledWith({ id: 'y_axis_x' })
      expect(mockChart.overrideYAxis).toHaveBeenCalledWith(expect.objectContaining({
        gap: { top: 0.2, bottom: 0.1 }
      }))
      // 退出分时恢复默认 x 轴
      expect(mockChart.overrideXAxis).toHaveBeenCalledWith(expect.objectContaining({ createTicks: expect.any(Function) }))
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

  it('分时加载官方数据后全天一屏适配', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => timeSharePayload }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      renderApp()
      // renderApp 内 updateFundamentalBar 会先发一次基本面请求，清空后再统计
      fetchMock.mockClear()
      const loader = mockChart.setDataLoader.mock.calls[0][0]
      const callback = vi.fn()
      timeShareState.active = true
      await loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: defaultSymbol,
        period: { span: 1, type: 'minute' },
        callback
      })
      // 仅保留 0930/0931 两根有效点，昨收取自 qt[4]；当日全量加载后无更多数据
      expect(callback).toHaveBeenCalledWith([
        expect.objectContaining({ close: 1277.27, volume: 133 }),
        expect.objectContaining({ close: 1283.89, volume: 556 })
      ], false)
      expect(timeShareState.dayKey).toBe('20260914')
      expect(timeShareState.prevClose).toBe(1275.16)
      // 数据就绪后同帧应用分时形态：移除主图指标、挂均价指标、百分比左轴与面积图
      expect(mockChart.removeIndicator).toHaveBeenCalledWith({ name: 'MA', paneId: 'candle_pane' })
      expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'TIME', paneId: 'candle_pane' }, true)
      expect(mockChart.createYAxis).toHaveBeenCalledWith({ paneId: 'candle_pane', position: 'left', name: 'cnTimePercent' })
      expect(mockChart.setStyles).toHaveBeenCalledWith({
        candle: {
          type: 'area',
          priceMark: { high: { show: false }, low: { show: false } }
        }
      })
      // 同帧完成全天一屏校准，不等轮询首次更新
      expect(mockChart.setBarSpace).toHaveBeenCalledWith(555 / 242)
      expect(mockChart.setOffsetRightDistance).toHaveBeenCalledWith(Math.round((242 - 2) * (555 / 242)))
      // 轮询首次更新后仍会复校一次（兜底左轴宽度变化）
      const updateCallback = vi.fn()
      loader.subscribeBar({
        symbol: defaultSymbol,
        period: { span: 1, type: 'minute' },
        callback: updateCallback
      })
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(updateCallback).toHaveBeenCalled()
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(mockChart.resize).toHaveBeenCalled()
      loader.unsubscribeBar({
        symbol: defaultSymbol,
        period: { span: 1, type: 'minute' }
      })
      // forward/backward 均返回空且无更多，杜绝与 offset 调整联动的重入死循环
      const moreCallback = vi.fn()
      for (const loadType of ['forward', 'backward'] as const) {
        await loader.getBars({
          type: loadType,
          timestamp: 1,
          symbol: defaultSymbol,
          period: { span: 1, type: 'minute' },
          callback: moreCallback
        })
      }
      expect(moreCallback).toHaveBeenCalledTimes(2)
      expect(moreCallback).toHaveBeenCalledWith([], { forward: false, backward: false })
      // init + 轮询首次各一次，forward/backward 不产生额外请求
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('分时数据加载失败时也切到分时形态并回调空数据', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('network error') })
    vi.stubGlobal('fetch', fetchMock)
    try {
      renderApp()
      const loader = mockChart.setDataLoader.mock.calls[0][0]
      const callback = vi.fn()
      timeShareState.active = true
      await loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: defaultSymbol,
        period: { span: 1, type: 'minute' },
        callback
      })
      expect(callback).toHaveBeenCalledWith([], false)
      // 失败同样切到分时形态，与普通周期加载失败后的空网格表现一致
      expect(mockChart.createIndicator).toHaveBeenCalledWith({ name: 'TIME', paneId: 'candle_pane' }, true)
      expect(mockChart.createYAxis).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('加载期间切走周期后放弃注入分时数据与形态', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => timeSharePayload }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      renderApp()
      const loader = mockChart.setDataLoader.mock.calls[0][0]
      const callback = vi.fn()
      timeShareState.active = true
      const pending = loader.getBars({
        type: 'init',
        timestamp: null,
        symbol: defaultSymbol,
        period: { span: 1, type: 'minute' },
        callback
      })
      // 数据在途时用户切走分时
      timeShareState.active = false
      await pending
      expect(callback).toHaveBeenCalledWith([], false)
      // 不再应用分时形态，避免污染新周期
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

  it('初始化应用 A 股配色：红涨绿跌并按昨收判定', () => {
    renderApp()
    expect(mockChart.setStyles).toHaveBeenCalledWith(expect.objectContaining({
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
    }))
  })

  it('重复点击「分时」不重复激活', () => {
    const root = renderApp()
    clickPeriod(root, 'time')
    const calls = mockChart.setPeriod.mock.calls.length
    clickPeriod(root, 'time')
    expect(mockChart.setPeriod.mock.calls.length).toBe(calls)
  })

  it('主题切换在分时激活时重新应用面积图样式', () => {
    const root = renderApp()
    clickPeriod(root, 'time')
    vi.clearAllMocks()
    root.querySelector<HTMLButtonElement>('#theme-btn')!.click()
    expect(mockChart.setStyles).toHaveBeenCalledWith('dark')
    expect(mockChart.setStyles).toHaveBeenCalledWith({
      candle: {
        type: 'area',
        priceMark: { high: { show: false }, low: { show: false } }
      }
    })
  })
})

describe('鼠标 K 线选择（右键切换）', () => {
  const rightClickChart = (root: HTMLDivElement) => {
    root.querySelector<HTMLElement>('#container')!
      .dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }))
  }

  beforeEach(() => {
    document.body.innerHTML = ''
    window.location.hash = ''
    vi.clearAllMocks()
    mockChart.getIndicators.mockReturnValue(defaultIndicators())
  })

  it('右键图表关闭：隐藏十字光标并将 crosshair 钉到最后一根（tooltip 固定）', () => {
    const root = renderApp()
    rightClickChart(root)
    expect(mockChart.setStyles).toHaveBeenCalledWith({ crosshair: { show: false } })
    expect(mockChart.executeAction).toHaveBeenCalledWith('onCrosshairChange', {})
  })

  it('再次右键恢复默认：重新显示十字光标并清除钉住的 crosshair', () => {
    const root = renderApp()
    rightClickChart(root)
    rightClickChart(root)
    expect(mockChart.setStyles).toHaveBeenCalledWith({ crosshair: { show: true } })
    expect(mockChart.executeAction).toHaveBeenLastCalledWith('onCrosshairChange', null)
  })

  it('关闭状态下鼠标移动的 crosshair 会被重新钉回最后一根', () => {
    const root = renderApp()
    rightClickChart(root)
    const subscription = mockChart.subscribeAction.mock.calls
      .find(([type]) => type === 'onCrosshairChange') as [string, (data: unknown) => void]
    expect(subscription).toBeTruthy()
    subscription![1]({ x: 100, y: 50, paneId: 'candle_pane' })
    expect(mockChart.executeAction).toHaveBeenLastCalledWith('onCrosshairChange', {})
  })

  it('开启状态下鼠标移动不干预 crosshair', () => {
    renderApp()
    const subscription = mockChart.subscribeAction.mock.calls
      .find(([type]) => type === 'onCrosshairChange') as [string, (data: unknown) => void]
    subscription![1]({ x: 100, y: 50, paneId: 'candle_pane' })
    expect(mockChart.executeAction).not.toHaveBeenCalled()
  })

  it('主题切换后重新应用鼠标选择状态', () => {
    const root = renderApp()
    rightClickChart(root)
    mockChart.setStyles.mockClear()
    root.querySelector<HTMLButtonElement>('#theme-btn')!.click()
    expect(mockChart.setStyles).toHaveBeenCalledWith({ crosshair: { show: false } })
  })
})

describe('分时图纯函数', () => {
  const minute = 60 * 1000

  it('parseTimeShareDay 解析官方分时点：差分量额、open 取前分钟价、过滤非交易时段', () => {
    const points = [
      '0930 1277.27 133 16987691.06',
      '0931 1283.89 689 88207201.15',
      '1131 1277.96 800 90000000.00',   // 午休后首点之前，超时段应被过滤
      '1300 1275.16 810 91000000.00',
      '1500 1277.96 16573 2116818687.60',
      '1530 1277.96 16573 2116818687.60', // 盘后冻结填充点，应被过滤
      'bad point',
      12345
    ]
    const bars = parseTimeShareDay('20260914', points, 1275.16)
    expect(bars).toHaveLength(4)
    expect(bars[0]).toEqual({
      timestamp: new Date('2026-09-14T09:30').getTime(),
      open: 1275.16,
      high: 1277.27,
      low: 1277.27,
      close: 1277.27,
      volume: 133,
      turnover: 16987691.06
    })
    // 差分：第二分钟量 689-133，额 88207201.15-16987691.06
    expect(bars[1].volume).toBe(556)
    expect(bars[1].turnover).toBeCloseTo(71219510.09, 2)
    expect(bars[1].open).toBe(1277.27)
    // 1300 的量基于上一个有效点 0931（1131 被过滤）差分
    expect(bars[2].volume).toBe(810 - 689)
    expect(bars[2].timestamp).toBe(new Date('2026-09-14T13:00').getTime())
    expect(bars[3].timestamp).toBe(new Date('2026-09-14T15:00').getTime())
    // 非法日期直接返回空
    expect(parseTimeShareDay('2026-9-14', points, 1)).toEqual([])
    expect(parseTimeShareDay('20260914', [], 1)).toEqual([])
  })

  it('parseTimeShareDay 科创板量为股，除以 200 换算为手', () => {
    const points = [
      '0930 116.80 290726 33956797.00',
      '0931 115.70 802754 93412556.00'
    ]
    const bars = parseTimeShareDay('20260914', points, 117.41, 200)
    expect(bars).toHaveLength(2)
    expect(bars[0].volume).toBe(Math.round(290726 / 200))
    expect(bars[0].turnover).toBe(33956797)
    expect(bars[1].volume).toBe(Math.round((802754 - 290726) / 200))
    expect(bars[1].turnover).toBe(93412556 - 33956797)
    expect(bars[0].open).toBe(117.41)
  })

  it('parseTimeShareDay 北交所无累计额列，turnover 留空', () => {
    const points = ['0930 10.82 0', '0931 10.67 243', '0932 10.82 342']
    const bars = parseTimeShareDay('20260914', points, 10.82)
    expect(bars).toHaveLength(3)
    expect(bars[1].volume).toBe(243)
    expect(bars[1].turnover).toBeUndefined()
    expect(bars[2].volume).toBe(342 - 243)
    expect(bars[2].turnover).toBeUndefined()
  })

  it('localDayKey 使用本地日期生成分组键', () => {
    expect(localDayKey(new Date('2026-09-14T23:59').getTime())).toBe('2026-9-14')
    expect(localDayKey(new Date('2026-01-02T00:00').getTime())).toBe('2026-1-2')
  })

  it('isCnStarMarket 仅识别沪市科创板代码', () => {
    expect(isCnStarMarket({ market: 'sh', ticker: '688981' })).toBe(true)
    expect(isCnStarMarket({ market: 'sh', ticker: '689009' })).toBe(true)
    expect(isCnStarMarket({ market: 'sh', ticker: '600519' })).toBe(false)
    expect(isCnStarMarket({ market: 'sz', ticker: '300750' })).toBe(false)
    expect(isCnStarMarket({ market: 'sz', ticker: '688981' })).toBe(false)
    expect(isCnStarMarket({ market: 'bj', ticker: '920001' })).toBe(false)
  })

  it('isCnIndex 按市场前缀识别沪深北指数，区分同名个股', () => {
    expect(isCnIndex({ market: 'sh', ticker: '000001' })).toBe(true)   // 上证指数
    expect(isCnIndex({ market: 'sh', ticker: '000300' })).toBe(true)   // 沪深300
    expect(isCnIndex({ market: 'sh', ticker: '000688' })).toBe(true)   // 科创50
    expect(isCnIndex({ market: 'sz', ticker: '399001' })).toBe(true)   // 深证成指
    expect(isCnIndex({ market: 'sz', ticker: '399006' })).toBe(true)   // 创业板指
    expect(isCnIndex({ market: 'bj', ticker: '899050' })).toBe(true)   // 北证50
    // 同代码不同市场是个股：sz000001 平安银行、sh300750 不存在但非指数
    expect(isCnIndex({ market: 'sz', ticker: '000001' })).toBe(false)
    expect(isCnIndex({ market: 'sh', ticker: '600519' })).toBe(false)
    expect(isCnIndex({ market: 'sz', ticker: '300750' })).toBe(false)
    expect(isCnIndex({ market: 'sh', ticker: '688981' })).toBe(false)  // 科创板个股
  })

  it('pickPrevClose 选取展示日前一交易日收盘价并处理边界', () => {
    const bar = (ts: number, close: number): KLineData =>
      ({ timestamp: ts, open: close - 1, close, high: close, low: close - 1, volume: 1 })
    const d11 = bar(new Date('2026-09-11T00:00').getTime(), 10)
    const d14 = bar(new Date('2026-09-14T00:00').getTime(), 11)
    const d15 = bar(new Date('2026-09-15T00:00').getTime(), 12)
    // 展示日在日 K 区间内：取前一日收盘
    expect(pickPrevClose([d11, d14, d15], localDayKey(d14.timestamp), 99)).toBe(10)
    // 盘中日线未生成（index === -1）：最近一根日线即昨日
    expect(pickPrevClose([d11, d14], localDayKey(d15.timestamp), 99)).toBe(11)
    // 展示日为最早一根：用当日开盘兜底
    expect(pickPrevClose([d14, d15], localDayKey(d14.timestamp), 99)).toBe(10)
    // 无日线：fallback
    expect(pickPrevClose([], '2026-9-14', 88)).toBe(88)
  })

  it('calcTimeShareAvg 优先使用官方成交额（手转股）计算均价', () => {
    const dataList: KLineData[] = [
      { timestamp: minute * 0, open: 10, close: 10, high: 10, low: 10, volume: 100, turnover: 100000 },
      { timestamp: minute * 1, open: 11, close: 12, high: 12, low: 11, volume: 300, turnover: 355000 },
      { timestamp: minute * 2, open: 11.5, close: 11, high: 12, low: 11, volume: 0, turnover: 0 }
    ]
    expect(calcTimeShareAvg(dataList)).toEqual([
      { avg: 100000 / (100 * 100) },
      { avg: 455000 / (400 * 100) },
      { avg: 455000 / (400 * 100) }
    ])
  })

  it('calcTimeShareAvg 科创板按每手 200 股换算均价', () => {
    timeShareState.lotSize = 200
    try {
      const dataList: KLineData[] = [
        { timestamp: minute * 0, open: 116, close: 116.8, high: 116.8, low: 116.8, volume: 1454, turnover: 33956797 },
        { timestamp: minute * 1, open: 116.8, close: 115.7, high: 116.8, low: 115.7, volume: 2560, turnover: 59455759 }
      ]
      const result = calcTimeShareAvg(dataList)
      expect(result[0].avg).toBeCloseTo(33956797 / (1454 * 200), 6)
      expect(result[1].avg).toBeCloseTo((33956797 + 59455759) / ((1454 + 2560) * 200), 6)
    } finally {
      timeShareState.lotSize = 100
    }
  })

  it('calcTimeShareAvg 缺少成交额时退回 close*volume 近似', () => {
    const dataList: KLineData[] = [
      { timestamp: minute * 0, open: 10, close: 10, high: 10, low: 10, volume: 10 },
      { timestamp: minute * 1, open: 11, close: 12, high: 12, low: 11, volume: 30 },
      { timestamp: minute * 2, open: 11.5, close: 11, high: 12, low: 11, volume: 0 }
    ]
    expect(calcTimeShareAvg(dataList)).toEqual([
      { avg: 10 },
      { avg: (10 * 10 + 12 * 30) / 40 },
      { avg: (10 * 10 + 12 * 30) / 40 }
    ])
  })

  it('calcTimeShareAvg 指数改用按量加权的点位均值，忽略成交额口径', () => {
    timeShareState.isIndex = true
    try {
      const dataList: KLineData[] = [
        { timestamp: minute * 0, open: 3860, close: 3861, high: 3861, low: 3861, volume: 100, turnover: 5102370437 },
        { timestamp: minute * 1, open: 3861, close: 3862, high: 3862, low: 3862, volume: 300, turnover: 25376748819 },
        { timestamp: minute * 2, open: 3862, close: 3858, high: 3862, low: 3858, volume: 0 }
      ]
      // 均价贴着点位量级（约 3861.x），而非额/量除以股数的 ~19
      expect(calcTimeShareAvg(dataList)).toEqual([
        { avg: 3861 },
        { avg: (3861 * 100 + 3862 * 300) / 400 },
        { avg: (3861 * 100 + 3862 * 300) / 400 }
      ])
      const avgs = calcTimeShareAvg(dataList).map(d => d.avg)
      expect(avgs[1]).toBeGreaterThan(3860)
      expect(avgs[1]).toBeLessThan(3863)
    } finally {
      timeShareState.isIndex = false
    }
  })

  it('symmetricRangeAround 以昨收为中心对称化区间', () => {
    const range = (from: number, to: number): AxisRange => ({
      from, to, range: to - from,
      realFrom: from, realTo: to, realRange: to - from,
      displayFrom: from, displayTo: to, displayRange: to - from
    })
    expect(symmetricRangeAround(100, range(98, 104))).toEqual(range(96, 104))
    // 基准价无效时原样返回
    const original = range(98, 104)
    expect(symmetricRangeAround(Number.NaN, original)).toBe(original)
    // 单边行情：区间覆盖基准价
    expect(symmetricRangeAround(100, range(100.5, 101))).toEqual(range(99, 101))
  })
})
