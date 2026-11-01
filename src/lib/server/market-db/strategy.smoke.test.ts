import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getMarketDb, marketDbPath } from './db'
import { DEFAULT_START, loadStrategy } from './strategy'

// 真库冒烟（dbdata/market.db 存在时才执行；CI/其它环境自动跳过）
// 断言全部锚定「历史不可变事实」（07-13 起的回放不会因快照库追加新交易日而变化），
// 不锚定 lastDate/期末净值等随数据增长漂移的量。
describe.skipIf(!existsSync(resolve(process.cwd(), 'dbdata/market.db')))('loadStrategy 真库冒烟', () => {
  it(
    '回放 A‴ 策略并命中已知历史成交',
    { timeout: 60_000 }, // 冷算含全市场 dailySignals，约 5~15s
    () => {
      const t0 = Date.now()
      const data = loadStrategy(getMarketDb(), DEFAULT_START)
      const ms = Date.now() - t0
      expect(data).not.toBeNull()
      const d = data!
      console.log('[smoke] path:', marketDbPath())
      console.log('[smoke] load ms:', ms, '| days:', d.meta.tradingDays, '| trades:', d.summary.closedCount)
      expect(ms).toBeLessThan(45_000)

      // 窗口与参数
      expect(d.meta.startDate).toBe('2026-07-13')
      expect(d.meta.params).toMatchObject({ walkN: 20, weeks: 3, pctLo: 3, pctHi: 5, takeProfit: 0.03, maxPick: 3 })
      expect(d.days.length).toBe(d.meta.tradingDays)
      expect(d.equityCurve.length).toBe(d.days.length)

      // 首个入选日：2026-07-14 医药商业（日榜 5，周榜 132→12→3 连升）
      const first = d.days.find((x) => x.selected != null)
      expect(first?.date).toBe('2026-07-14')
      expect(first?.selected?.concept).toBe('医药商业')
      expect(first?.buys.length).toBeGreaterThan(0)

      // 历史成交锚点：博济医药 08-11 买入、止盈离场（+22.56%，单候选与持仓上限无关）
      const boji = d.trades.find((x) => x.code === '300404' && x.buyDate === '2026-08-11')
      expect(boji).toBeDefined()
      expect(boji?.reason).toBe('takeprofit')
      expect(boji?.pnlPct).toBeGreaterThan(20)

      // 一致性：净值曲线末点 = 最后一个交易日净值；净值 = 现金 + 持仓市值
      expect(d.equityCurve[d.equityCurve.length - 1]?.equity).toBeCloseTo(d.days[d.days.length - 1]!.equity, 6)
      expect(d.summary.equity).toBeCloseTo(d.summary.cash + d.summary.marketValue, 0)

      // 走查透视与表内状态一致
      expect(d.latest.walk.length).toBe(d.meta.params.walkN)
      expect(d.latest.date).toBe(d.days[d.days.length - 1]!.date)
      const pickedRow = d.latest.walk.find((w) => w.concept === d.days[d.days.length - 1]!.selected?.concept)
      if (pickedRow != null) {
        expect(pickedRow.rising).toBe(true)
      }
    }
  )
})
