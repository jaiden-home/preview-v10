import { describe, expect, it } from 'vitest'
import type { MarketDataProvider } from './types'

const SYMBOL = { market: 'sh', ticker: '600519' }
const ts = (day: string) => new Date(`${day}T00:00:00`).getTime()

/**
 * Provider 契约测试套件：对任意数据源实例跑同一套领域断言，保证可替换性。
 * 新数据源上线门槛 = 实现 MarketDataProvider + 通过本套件；
 * 上游响应由具体 provider 的测试文件在 beforeEach 中 stub 为有效数据。
 */
export const runProviderContractTests = (makeProvider: () => MarketDataProvider): void => {
  describe('provider contract', () => {
    it('暴露合法 id 与能力声明', () => {
      const provider = makeProvider()
      expect(provider.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(typeof provider.capabilities.timeShare).toBe('boolean')
      expect(typeof provider.capabilities.search).toBe('boolean')
      expect(Array.isArray(provider.capabilities.periods)).toBe(true)
      expect(provider.capabilities.periods.length).toBeGreaterThan(0)
    })

    it('fetchQuote 返回领域快照', async () => {
      const quote = await makeProvider().fetchQuote(SYMBOL)
      expect(quote.market).toBe('sh')
      expect(quote.ticker).toBe('600519')
      expect(quote.name === null || typeof quote.name === 'string').toBe(true)
      expect(quote.price === null || quote.price > 0).toBe(true)
      expect(quote.prevClose === null || quote.prevClose > 0).toBe(true)
      expect(typeof quote.fundamental).toBe('object')
    })

    it('fetchKLines 返回窗口内且时间戳单调递增的 bars', async () => {
      const from = ts('2026-09-14')
      const to = ts('2026-09-16')
      const bars = await makeProvider().fetchKLines(SYMBOL, { span: 1, type: 'day' }, from, to)
      expect(bars.length).toBeGreaterThan(0)
      for (const bar of bars) {
        expect(bar.timestamp).toBeGreaterThanOrEqual(from)
        expect(bar.timestamp).toBeLessThanOrEqual(to)
        expect(Number.isFinite(bar.open)).toBe(true)
        expect(Number.isFinite(bar.close)).toBe(true)
        expect(bar.high).toBeGreaterThanOrEqual(bar.low)
      }
      for (let i = 1; i < bars.length; i++) {
        expect(bars[i].timestamp).toBeGreaterThan(bars[i - 1].timestamp)
      }
    })

    it('fetchTimeShare 返回当日快照（date 为 YYYYMMDD）', async () => {
      const snapshot = await makeProvider().fetchTimeShare(SYMBOL)
      expect(snapshot.date).toMatch(/^\d{8}$/)
      expect(snapshot.prevClose).toBeGreaterThan(0)
      expect(snapshot.bars.length).toBeGreaterThan(0)
    })

    it('searchSymbols 返回合法标的条目', async () => {
      const items = await makeProvider().searchSymbols('600519')
      expect(Array.isArray(items)).toBe(true)
      for (const item of items) {
        expect(item.market).toMatch(/^(sh|sz|bj)$/)
        expect(item.ticker).toMatch(/^\d{6}$/)
        expect(typeof item.name).toBe('string')
      }
    })
  })
}
