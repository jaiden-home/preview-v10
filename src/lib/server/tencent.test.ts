import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Period } from 'klinecharts'
import { parseQtQuote } from '../fundamental'
import { formatTencentDate } from '../chart/utils'
import { fetchCnKLines, parseSmartboxResponse, resetServerCaches } from './tencent'

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

describe('fetchCnKLines 缓存路由', () => {
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

  beforeEach(() => {
    resetServerCaches()
    vi.unstubAllGlobals()
  })

  it('不同 from/to 的近端请求共享同一份回源，各自窗口独立裁剪', async () => {
    const rows = [dayRow('2026-09-14', 14), dayRow('2026-09-15', 15), dayRow('2026-09-16', 16)]
    const fetchMock = vi.fn(async (_url: string) => fqDay(rows))
    vi.stubGlobal('fetch', fetchMock)

    const a = await fetchCnKLines(symbol, dayPeriod, ts('2026-09-14'), ts('2026-09-15'))
    const b = await fetchCnKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
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
    const bars = await fetchCnKLines(symbol, dayPeriod, from, to)
    await fetchCnKLines(symbol, dayPeriod, from, to)
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

    const bars = await fetchCnKLines(symbol, minute, 0, new Date('2026-09-18T09:30').getTime() - 1)
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
    const bars = await fetchCnKLines(symbol, hour4, from, to)
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
    const results = await Promise.all(windows.map(([from, to]) => fetchCnKLines(symbol, dayPeriod, from, to)))
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

      await fetchCnKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
      await fetchCnKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
      expect(fetchMock).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(3_001)
      await fetchCnKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
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

    const bars = await fetchCnKLines(symbol, dayPeriod, base, base + 600 * 86_400_000)
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
    const inside = await fetchCnKLines(symbol, dayPeriod, oldest, ts('2026-09-15'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(inside.map((d) => d.close)).toEqual([14, 15])

    // from = oldest - 1ms：转历史查询，URL 带起止日期
    const hist = await fetchCnKLines(symbol, dayPeriod, oldest - 1, ts('2026-09-15'))
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
    const bars = await fetchCnKLines(symbol, dayPeriod, from, now)
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

    await expect(fetchCnKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))).rejects.toThrow('upstream down')
    const bars = await fetchCnKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bars.map((d) => d.close)).toEqual([15])
  })

  it('不同周期使用独立的缓存条目', async () => {
    const fetchMock = vi.fn(async (_url: string) => fqDay([dayRow('2026-09-15', 15)]))
    vi.stubGlobal('fetch', fetchMock)
    const week: Period = { span: 1, type: 'week' }

    await fetchCnKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
    await fetchCnKLines(symbol, week, ts('2026-09-15'), ts('2026-09-16'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain(',day,')
    expect(String(fetchMock.mock.calls[1][0])).toContain(',week,')
  })

  it('不同标的互不共享缓存', async () => {
    const fetchMock = vi.fn(async (_url: string) => fqDay([dayRow('2026-09-15', 15)]))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCnKLines(symbol, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
    await fetchCnKLines({ market: 'sz', ticker: '000001' }, dayPeriod, ts('2026-09-15'), ts('2026-09-16'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toContain('param=sz000001,day,')
  })
})
