import { describe, expect, it, vi } from 'vitest'
import type { KLineData, Period } from 'klinecharts'
import { fetchTimeShare, searchSymbols } from './market-service'
import type { MarketDataProvider, ProviderCapabilities } from './provider/types'

const { makeFakeProvider, currentProvider } = vi.hoisted(() => {
  let current: unknown
  return {
    currentProvider: (): unknown => current,
    makeFakeProvider: (overrides: Partial<ProviderCapabilities>): unknown => {
      const minuteBars: KLineData[] = [
        {
          timestamp: new Date().setHours(9, 30, 0, 0),
          open: 10,
          close: 10.5,
          high: 10.6,
          low: 9.9,
          volume: 100
        },
        {
          timestamp: new Date().setHours(9, 31, 0, 0),
          open: 10.5,
          close: 10.8,
          high: 11,
          low: 10.4,
          volume: 200
        }
      ]
      current = {
        id: 'fake',
        capabilities: { timeShare: true, search: true, periods: ['1d'], ...overrides },
        fetchQuote: vi.fn(async () => ({
          market: 'sh',
          ticker: '600519',
          name: 'Foo',
          price: 10.8,
          prevClose: 10.2,
          fundamental: {}
        })),
        fetchKLines: vi.fn(async (_symbol: unknown, period: Period) => (period.type === 'minute' ? minuteBars : [])),
        fetchTimeShare: vi.fn(async () => {
          throw new Error('native timeshare should not be called')
        }),
        searchSymbols: vi.fn(async () => {
          throw new Error('native search should not be called')
        })
      }
      return current
    }
  }
})

vi.mock('./provider/registry', () => ({ getProvider: () => currentProvider() }))

const asProvider = (): MarketDataProvider => currentProvider() as MarketDataProvider

describe('market-service 能力降级', () => {
  it('fetchTimeShare 无原生分时时由当日 1 分钟 K 合成', async () => {
    makeFakeProvider({ timeShare: false })
    const snapshot = await fetchTimeShare({ market: 'sh', ticker: '600519' })
    const now = new Date()
    const month = `${now.getMonth() + 1}`.padStart(2, '0')
    const day = `${now.getDate()}`.padStart(2, '0')
    expect(snapshot.date).toBe(`${now.getFullYear()}${month}${day}`)
    expect(snapshot.prevClose).toBe(10.2)
    // 降级合成：日开/高/低来自当日 1 分钟 K
    expect(snapshot.open).toBe(10)
    expect(snapshot.high).toBe(11)
    expect(snapshot.low).toBe(9.9)
    expect(snapshot.bars).toHaveLength(2)
  })

  it('fetchTimeShare 合成无分钟数据时抛 ProviderError', async () => {
    makeFakeProvider({ timeShare: false })
    await vi.mocked(asProvider().fetchKLines).mockResolvedValueOnce([])
    await expect(fetchTimeShare({ market: 'sh', ticker: '600519' })).rejects.toThrow('time share synthesis is empty')
  })

  it('fetchTimeShare 昨收缺失时回退首根开盘价', async () => {
    makeFakeProvider({ timeShare: false })
    await vi.mocked(asProvider().fetchQuote).mockResolvedValueOnce({
      market: 'sh',
      ticker: '600519',
      name: 'Foo',
      price: 10.8,
      prevClose: null,
      fundamental: {}
    })
    const snapshot = await fetchTimeShare({ market: 'sh', ticker: '600519' })
    expect(snapshot.prevClose).toBe(10.5)
  })

  it('searchSymbols 无联想能力时降级为代码精确匹配', async () => {
    makeFakeProvider({ search: false })
    expect(await searchSymbols('600519')).toEqual([{ ticker: '600519', name: 'Foo', market: 'sh' }])
    expect(await searchSymbols('sz000001')).toEqual([{ ticker: '000001', name: 'Foo', market: 'sz' }])
    expect(await searchSymbols('茅台')).toEqual([])
    expect(await searchSymbols('  ')).toEqual([])
  })

  it('能力齐备时直接透传 provider 实现', async () => {
    makeFakeProvider({})
    await vi.mocked(asProvider().searchSymbols).mockResolvedValueOnce([{ ticker: '600519', name: 'Foo', market: 'sh' }])
    await vi.mocked(asProvider().fetchTimeShare).mockResolvedValueOnce({
      date: '20260918',
      prevClose: 10,
      open: 10.1,
      high: 10.5,
      low: 9.8,
      bars: []
    })
    expect(await searchSymbols('maotai')).toEqual([{ ticker: '600519', name: 'Foo', market: 'sh' }])
    expect(await fetchTimeShare({ market: 'sh', ticker: '600519' })).toEqual({
      date: '20260918',
      prevClose: 10,
      open: 10.1,
      high: 10.5,
      low: 9.8,
      bars: []
    })
  })
})
