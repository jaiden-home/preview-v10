import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Period } from 'klinecharts'
import { runProviderContractTests } from '../contract'
import type { MarketDataProvider } from '../types'
import { createTencentProvider } from './index'
import { formatTencentDate, parseQtQuote, parseSmartboxResponse, parseTimeShareDay, parseTencentKlines } from './parse'

/** 构造腾讯 qt 行情文本：字段索引与线上接口一致 */
const buildQtText = (code: string, fields: Record<number, string>): string => {
  const array = new Array(60).fill('')
  for (const [index, value] of Object.entries(fields)) {
    array[Number(index)] = value
  }
  return `v_${code}="${array.join('~')}";`
}

describe('parseQtQuote', () => {
  const code = 'sh600519'

  it('解析名称、现价、昨收与基本面字段', () => {
    const text = buildQtText(code, {
      1: '贵州茅台',
      3: '1700.00',
      4: '1675.00',
      38: '0.28',
      39: '28.5',
      43: '1.67',
      44: '21,000.00',
      45: '21,500.00',
      46: '9.87',
      51: '1698.12',
      52: '27.1',
      53: '30.9'
    })
    const parsed = parseQtQuote(text, code)
    expect(parsed.invalid).toBe(false)
    expect(parsed.name).toBe('贵州茅台')
    expect(parsed.price).toBe(1700)
    expect(parsed.prevClose).toBe(1675)
    expect(parsed.fundamental).toEqual({
      turnoverRate: 0.28,
      amplitude: 1.67,
      pe: 28.5,
      peDynamic: 27.1,
      peStatic: 30.9,
      pb: 9.87,
      totalMarketCap: 21500_0000_0000,
      floatMarketCap: 21000_0000_0000,
      avgPrice: 1698.12
    })
  })

  it('缺失/占位字段返回 undefined，负市盈率保留', () => {
    const text = buildQtText(code, { 1: '某股', 3: '10.00', 4: '9.00', 39: '-5.5' })
    const parsed = parseQtQuote(text, code)
    expect(parsed.fundamental.pe).toBe(-5.5)
    expect(parsed.fundamental.pb).toBeUndefined()
    expect(parsed.fundamental.totalMarketCap).toBeUndefined()
  })

  it('代码不匹配或名称占位视为无效', () => {
    expect(parseQtQuote('v_sz000001="1~平安银行~..."', 'sh600519').invalid).toBe(true)
    const dash = buildQtText(code, { 1: '-' })
    expect(parseQtQuote(dash, code).invalid).toBe(true)
  })
})

describe('parseSmartboxResponse', () => {
  it('解析代码前置格式：["sh600519~贵州茅台~gp~sh"]', () => {
    const items = parseSmartboxResponse('v_hint=["sh600519~贵州茅台~gp~sh","sz000001~平安银行~gp~sz"]')
    expect(items).toEqual([
      { ticker: '600519', name: '贵州茅台', market: 'sh' },
      { ticker: '000001', name: '平安银行', market: 'sz' }
    ])
  })

  it('解析代码后置格式：["600519~贵州茅台~sh600519"]', () => {
    const items = parseSmartboxResponse('v_hint=["600519~贵州茅台~sh600519"]')
    expect(items).toEqual([{ ticker: '600519', name: '贵州茅台', market: 'sh' }])
  })

  it('过滤非 A 股市场与坏条目，限制返回数量', () => {
    const items = parseSmartboxResponse('v_hint=["hk00700~腾讯控股~gp~hk","sh600519~贵州茅台~gp~sh","garbage","12345"]')
    expect(items).toEqual([{ ticker: '600519', name: '贵州茅台', market: 'sh' }])
  })

  it('无法解析的文本返回空数组', () => {
    expect(parseSmartboxResponse('')).toEqual([])
    expect(parseSmartboxResponse('v_hint=[broken')).toEqual([])
  })
})

describe('parseTencentKlines', () => {
  it('解析日K/分钟K并过滤坏行', () => {
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
})

describe('parseTimeShareDay', () => {
  it('解析官方分时点：差分量额、open 取前分钟价、过滤非交易时段', () => {
    const points = [
      '0930 1277.27 133 16987691.06',
      '0931 1283.89 689 88207201.15',
      '1131 1277.96 800 90000000.00', // 午休后首点之前，超时段应被过滤
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

  it('科创板量为股，除以 200 换算为手', () => {
    const points = ['0930 116.80 290726 33956797.00', '0931 115.70 802754 93412556.00']
    const bars = parseTimeShareDay('20260914', points, 117.41, 200)
    expect(bars).toHaveLength(2)
    expect(bars[0].volume).toBe(Math.round(290726 / 200))
    expect(bars[0].turnover).toBe(33956797)
    expect(bars[1].volume).toBe(Math.round((802754 - 290726) / 200))
    expect(bars[1].turnover).toBe(93412556 - 33956797)
    expect(bars[0].open).toBe(117.41)
  })

  it('北交所无累计额列，turnover 留空', () => {
    const points = ['0930 10.82 0', '0931 10.67 243', '0932 10.82 342']
    const bars = parseTimeShareDay('20260914', points, 10.82)
    expect(bars).toHaveLength(3)
    expect(bars[1].volume).toBe(243)
    expect(bars[1].turnover).toBeUndefined()
    expect(bars[2].volume).toBe(342 - 243)
    expect(bars[2].turnover).toBeUndefined()
  })
})

describe('fetchKLines 缓存路由', () => {
  const symbol = { market: 'sh', ticker: '600519' }
  const dayPeriod: Period = { span: 1, type: 'day' }
  const ts = (day: string) => new Date(`${day}T00:00:00`).getTime()
  /** 腾讯日 K 行：日期, 开, 收, 高, 低, 量 */
  const dayRow = (day: string, close: number) => [day, '10.00', String(close), '11.00', '9.00', '1000']
  const fqDay = (rows: unknown[]) => ({ ok: true, json: async () => ({ data: { sh600519: { qfqday: rows } } }) })
  const mkline = (key: string, rows: unknown[]) => ({
    ok: true,
    json: async () => ({ data: { sh600519: { [key]: rows } } })
  })

  let provider: MarketDataProvider

  beforeEach(() => {
    // 每个用例重建 provider：缓存为 provider 内部状态，重建即重置（替代原 resetServerCaches）
    provider = createTencentProvider()
    vi.unstubAllGlobals()
  })

  it('不同 from/to 的近端请求共享同一份回源，各自窗口独立裁剪', async () => {
    const rows = [dayRow('2026-09-14', 14), dayRow('2026-09-15', 15), dayRow('2026-09-16', 16)]
    const fetchMock = vi.fn(async (_url: string) => fqDay(rows))
    vi.stubGlobal('fetch', fetchMock)

    const a = await provider.fetchKLines(symbol, dayPeriod, ts('2026-09-14'), ts('2026-09-15'))
    const b = await provider.fetchKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
    // 核心语义：窗口不同也只回源一次（近端原始数据全员共享），裁剪在缓存外
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('param=sh600519,day,,,640,qfq')
    expect(a.map((d) => d.close)).toEqual([14, 15])
    expect(b.map((d) => d.close)).toEqual([15, 16])
  })

  it('窗口越过近端边界（日族）走历史缓存：带起止日期，同窗口只回源一次', async () => {
    const recent = [dayRow('2026-09-14', 14), dayRow('2026-09-15', 15)]
    const old = [dayRow('2026-08-03', 3), dayRow('2026-08-04', 4)]
    const fetchMock = vi.fn(async (url: string) => (url.includes(',2026-08-01,') ? fqDay(old) : fqDay(recent)))
    vi.stubGlobal('fetch', fetchMock)

    const from = ts('2026-08-01')
    const to = ts('2026-08-04')
    const bars = await provider.fetchKLines(symbol, dayPeriod, from, to)
    await provider.fetchKLines(symbol, dayPeriod, from, to)
    // raw 1 次 + hist 1 次；同窗口第二次命中缓存
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const histUrl = fetchMock.mock.calls.map(([url]) => String(url)).find((url) => url.includes(',2026-08-01,'))
    expect(histUrl).toContain('param=sh600519,day,2026-08-01,2026-08-04,640,qfq')
    expect(bars.map((d) => d.close)).toEqual([3, 4])
  })

  it('分钟族窗口早于近端最旧一根返回空，不额外回源', async () => {
    const rows = [['202609180930', '10.00', '10.50', '11.00', '9.00', '1000']]
    const fetchMock = vi.fn(async (_url: string) => mkline('m1', rows))
    vi.stubGlobal('fetch', fetchMock)
    const minute: Period = { span: 1, type: 'minute' }

    const bars = await provider.fetchKLines(symbol, minute, 0, new Date('2026-09-18T09:30').getTime() - 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/kline/mkline?param=sh600519,m1,,640')
    expect(bars).toEqual([])
  })

  it('4h 周期复用 m60 原始数据并按请求本地聚合', async () => {
    const rows = [
      ['202609180930', '10.00', '11.00', '11.50', '9.50', '100'],
      ['202609181030', '11.00', '12.00', '12.50', '10.50', '200']
    ]
    const fetchMock = vi.fn(async (_url: string) => mkline('m60', rows))
    vi.stubGlobal('fetch', fetchMock)
    const hour4: Period = { span: 4, type: 'hour' }

    const from = new Date('2026-09-18T08:00').getTime()
    const to = new Date('2026-09-18T12:00').getTime()
    const bars = await provider.fetchKLines(symbol, hour4, from, to)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('mkline?param=sh600519,m60,,640')
    expect(bars).toHaveLength(1)
    expect(bars[0]).toMatchObject({ open: 10, close: 12, high: 12.5, low: 9.5, volume: 300 })
  })

  it('并发不同窗口请求合并为一次回源（在途去重）', async () => {
    const rows = [dayRow('2026-09-14', 14), dayRow('2026-09-15', 15), dayRow('2026-09-16', 16)]
    // 首次回源延迟 10ms，让后续并发请求全部落在在途窗口内
    const fetchMock = vi.fn(async (_url: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return fqDay(rows)
    })
    vi.stubGlobal('fetch', fetchMock)

    const windows: Array<[number, number]> = [
      [ts('2026-09-14'), ts('2026-09-15')],
      [ts('2026-09-15'), ts('2026-09-16')],
      [ts('2026-09-14'), ts('2026-09-16')],
      [ts('2026-09-16'), ts('2026-09-16')],
      [ts('2026-09-15'), ts('2026-09-15')]
    ]
    const results = await Promise.all(windows.map(([from, to]) => provider.fetchKLines(symbol, dayPeriod, from, to)))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    results.forEach((bars, i) => {
      const [from, to] = windows[i]
      expect(bars.map((d) => d.close)).toEqual(
        rows
          .map((r) => Number(r[2]))
          .filter((_, idx) => {
            const t = new Date(`${rows[idx][0]}T00:00:00`).getTime()
            return t >= from && t <= to
          })
      )
    })
  })

  it('TTL 过期后重新回源', async () => {
    vi.useFakeTimers()
    try {
      const rows = [dayRow('2026-09-15', 15)]
      const fetchMock = vi.fn(async (_url: string) => fqDay(rows))
      vi.stubGlobal('fetch', fetchMock)

      await provider.fetchKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
      await provider.fetchKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
      expect(fetchMock).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(3_001)
      await provider.fetchKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('超过 500 根时保留最新 500 根（BAR_LIMIT 截断）', async () => {
    const base = ts('2024-01-01')
    const rows = Array.from({ length: 600 }, (_, i) => {
      const d = new Date(base + i * 86_400_000)
      const day = formatTencentDate(d.getTime())
      return dayRow(day, i)
    })
    const fetchMock = vi.fn(async (_url: string) => fqDay(rows))
    vi.stubGlobal('fetch', fetchMock)

    const bars = await provider.fetchKLines(symbol, dayPeriod, base, base + 600 * 86_400_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bars).toHaveLength(500)
    // 丢最旧 100 根，保留第 100..599 根
    expect(bars[0].close).toBe(100)
    expect(bars[499].close).toBe(599)
  })

  it('from 恰好等于近端最旧走 raw 路径；早 1ms 则转历史查询', async () => {
    const rows = [dayRow('2026-09-14', 14), dayRow('2026-09-15', 15)]
    const histRows = [dayRow('2026-09-14', 13)]
    const fetchMock = vi.fn(async (url: string) => (url.includes(',2026-09-13,') ? fqDay(histRows) : fqDay(rows)))
    vi.stubGlobal('fetch', fetchMock)

    const oldest = ts('2026-09-14')
    // from == oldest：完全落在近端，仅 raw 一次回源且最旧一根包含在结果里
    const inside = await provider.fetchKLines(symbol, dayPeriod, oldest, ts('2026-09-15'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(inside.map((d) => d.close)).toEqual([14, 15])

    // from = oldest - 1ms：转历史查询，URL 带起止日期
    const hist = await provider.fetchKLines(symbol, dayPeriod, oldest - 1, ts('2026-09-15'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `param=sh600519,day,${formatTencentDate(oldest - 1)},2026-09-15,640,qfq`
    )
    expect(hist.map((d) => d.close)).toEqual([13])
  })

  it('历史窗口覆盖今天时 end 留空（腾讯带 end 会漏掉当天 bar）', async () => {
    const now = Date.now()
    const tenDaysAgo = formatTencentDate(now - 10 * 86_400_000)
    const rows = [dayRow(formatTencentDate(now - 2 * 86_400_000), 2), dayRow(formatTencentDate(now - 86_400_000), 1)]
    const fetchMock = vi.fn(async (_url: string) => fqDay(rows))
    vi.stubGlobal('fetch', fetchMock)

    // from 早于 raw 最旧 → 走历史查询；to = 今天 → end 参数必须为空
    const from = now - 10 * 86_400_000
    const bars = await provider.fetchKLines(symbol, dayPeriod, from, now)
    const histUrl = String(fetchMock.mock.calls.find(([url]) => String(url).includes(`,${tenDaysAgo},`))?.[0])
    expect(histUrl).toContain(`param=sh600519,day,${tenDaysAgo},,640,qfq`)
    expect(bars.map((d) => d.close)).toEqual([2, 1])
  })

  it('上游失败向上抛出且不污染缓存，下次请求重试', async () => {
    const rows = [dayRow('2026-09-15', 15)]
    const fetchMock = vi.fn(async (_url: string) => {
      if (fetchMock.mock.calls.length === 1) {
        throw new Error('upstream down')
      }
      return fqDay(rows)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider.fetchKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))).rejects.toThrow(
      'upstream down'
    )
    const bars = await provider.fetchKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bars.map((d) => d.close)).toEqual([15])
  })

  it('不同周期使用独立的缓存条目', async () => {
    const fetchMock = vi.fn(async (_url: string) => fqDay([dayRow('2026-09-15', 15)]))
    vi.stubGlobal('fetch', fetchMock)
    const week: Period = { span: 1, type: 'week' }

    await provider.fetchKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
    await provider.fetchKLines(symbol, week, ts('2026-09-15'), ts('2026-09-16'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain(',day,')
    expect(String(fetchMock.mock.calls[1][0])).toContain(',week,')
  })

  it('不同标的互不共享缓存', async () => {
    const fetchMock = vi.fn(async (_url: string) => fqDay([dayRow('2026-09-15', 15)]))
    vi.stubGlobal('fetch', fetchMock)

    await provider.fetchKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
    await provider.fetchKLines({ market: 'sz', ticker: '000001' }, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toContain('param=sz000001,day,')
  })
})

describe('tencent provider 契约', () => {
  /** GBK 文本响应桩（数字段 ASCII 安全） */
  const gbkText = (text: string) => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(text) })

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('qt.gtimg.cn')) {
          return gbkText(buildQtText('sh600519', { 1: 'Foo', 3: '1700.00', 4: '1675.00' }))
        }
        if (url.includes('/kline/mkline')) {
          return {
            ok: true,
            json: async () => ({
              data: { sh600519: { m1: [['202609180930', '10.00', '10.50', '11.00', '9.00', '100']] } }
            })
          }
        }
        if (url.includes('fqkline/get')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                sh600519: {
                  qfqday: [
                    ['2026-09-14', '10.00', '14', '11.00', '9.00', '1000'],
                    ['2026-09-15', '10.00', '15', '11.00', '9.00', '1000'],
                    ['2026-09-16', '10.00', '16', '11.00', '9.00', '1000']
                  ]
                }
              }
            })
          }
        }
        if (url.includes('day/query')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                sh600519: {
                  qt: { sh600519: ['', 'Foo', '600519', '1700.00', '1675.00'] },
                  data: [{ date: '20260918', data: ['0930 1700.00 100 170000.00'] }]
                }
              }
            })
          }
        }
        if (url.includes('smartbox')) {
          return gbkText('v_hint=["sh600519~Foo~gp~sh"]')
        }
        throw new Error(`unexpected upstream url: ${url}`)
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  runProviderContractTests(() => createTencentProvider())
})
