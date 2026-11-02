import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getMarketDb, marketDbPath } from './db'
import { ACTIVE_VERSION, loadStrategy, STRATEGY_VERSIONS } from './strategy'
import type { StrategyVersionDef } from '../../strategy/types'

// 回测验证锚点：v1 参数 + 07-13 起始（与运行时 ACTIVE_VERSION 的起始日解耦——历史断言锚定不可变事实）
const BACKTEST_ANCHOR = '2026-07-13'
const anchorDef: StrategyVersionDef = {
  id: 'backtest',
  label: 'smoke anchor',
  start: BACKTEST_ANCHOR,
  params: STRATEGY_VERSIONS[0]!.params
}

// 真库冒烟（dbdata/market.db 存在时才执行；CI/其它环境自动跳过）
// 断言全部锚定「历史不可变事实」（07-13 起的回放不会因快照库追加新交易日而变化），
// 不锚定 lastDate/期末净值等随数据增长漂移的量。
describe.skipIf(!existsSync(resolve(process.cwd(), 'dbdata/market.db')))('loadStrategy 真库冒烟', () => {
  it(
    '回放 A‴ 策略并命中已知历史成交',
    { timeout: 120_000 }, // 冷算含全市场 dailySignals，约 5~15s/次（本用例含 4 次回放：锚定 + 区间×2 + 倒置空区间）
    () => {
      const t0 = Date.now()
      const data = loadStrategy(getMarketDb(), anchorDef)
      const ms = Date.now() - t0
      expect(data).not.toBeNull()
      const d = data!
      console.log('[smoke] path:', marketDbPath())
      console.log('[smoke] load ms:', ms, '| days:', d.meta.tradingDays, '| trades:', d.summary.closedCount)
      expect(ms).toBeLessThan(45_000)

      // 窗口与参数（止盈 2026-11-03 定版 12%：12% 口径下博济医药同在 08-13 大涨日越过止盈线离场，历史锚点不变）
      expect(d.meta.version).toBe('backtest')
      expect(d.meta.startDate).toBe(BACKTEST_ANCHOR)
      expect(d.meta.params).toMatchObject({
        walkN: 20,
        weeks: 3,
        pctLo: 3,
        pctHi: 5,
        takeProfit: 0.12,
        stopBuffer: 0,
        maxPick: 3
      })
      expect(d.meta.params.bPoint).toMatchObject({
        runDays: 3,
        highTol: 0.999,
        maDays: 30,
        tailRepairMin: 0.5,
        fadeRatio: 0.15
      })
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

      // 版本注册表：v1 止盈 12% 进攻版 + v2 高胜率防守版（当前执行；追加 v3 时本断言须一并更新）
      expect(STRATEGY_VERSIONS.map((v) => v.id)).toEqual(['v1', 'v2'])
      expect(ACTIVE_VERSION.id).toBe('v2')
      expect(ACTIVE_VERSION.start).toBe('2026-11-02')
      expect(ACTIVE_VERSION.params).toMatchObject({
        walkN: 15,
        weeks: 3,
        pctLo: 2.5,
        pctHi: 4,
        takeProfit: 0.03,
        stopBuffer: 0.02,
        maxPick: 3
      })
      expect(ACTIVE_VERSION.params.bPoint).toMatchObject({ ...STRATEGY_VERSIONS[0]!.params.bPoint, runDays: 4 })

      // 股票池 = 全部启用股（停牌不参与）：全程任意买入 ∈ 启用股，且买入日必有该股 K 线、成交价 = 当日收盘
      const db = getMarketDb()
      const enabledSet = new Set(
        (db.prepare('SELECT code FROM stocks WHERE enabled = 1').all() as Array<{ code: string }>).map((r) => r.code)
      )
      const buyBar = db.prepare('SELECT close FROM kline_daily WHERE code = ? AND trade_date = ?')
      for (const x of d.days) {
        for (const b of x.buys) {
          expect(enabledSet.has(b.code)).toBe(true)
          const bar = buyBar.get(b.code, x.date) as { close: number } | undefined
          expect(bar).toBeDefined()
          expect(bar?.close).toBeCloseTo(b.price, 6)
        }
      }

      // 时间范围覆盖·to 截断：截断回放 = 全量回放的因果前缀（逐日净值一致），lastDate 不越过截至日
      const trunc = loadStrategy(getMarketDb(), anchorDef, { to: '2026-08-31' })
      expect(trunc).not.toBeNull()
      expect(trunc!.meta.startDate).toBe(BACKTEST_ANCHOR)
      expect(trunc!.meta.lastDate <= '2026-08-31').toBe(true)
      expect(trunc!.meta.tradingDays).toBeLessThan(d.meta.tradingDays)
      const fullByDate = new Map(d.days.map((x) => [x.date, x.equity]))
      for (const x of trunc!.days) {
        expect(fullByDate.get(x.date)).toBeCloseTo(x.equity, 6)
      }

      // 时间范围覆盖·from 覆盖起始日：startDate = 起始日起其后首个交易日，全程不早于起始日
      const shifted = loadStrategy(getMarketDb(), anchorDef, { from: '2026-08-01' })
      expect(shifted).not.toBeNull()
      expect(shifted!.meta.startDate >= '2026-08-01').toBe(true)
      expect(shifted!.days.every((x) => x.date >= '2026-08-01')).toBe(true)

      // 区间倒置/非法由 parseStrategyRange 拦截（见 types.test.ts），loadStrategy 不应收到——空区间返回 null
      expect(loadStrategy(getMarketDb(), anchorDef, { from: '2026-09-10', to: '2026-09-01' })).toBeNull()
    }
  )
})
