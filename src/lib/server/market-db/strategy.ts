import type { DatabaseSync } from 'node:sqlite'
import {
  STRATEGY_CAPITAL,
  type StrategyBuy,
  type StrategyBundle,
  type StrategyData,
  type StrategyDay,
  type StrategyPosition,
  type StrategyRange,
  type StrategySell,
  type StrategyVersionDef,
  type StrategyWalkRow
} from '../../strategy/types'
import { dailySignals, DEFAULT_B_POINT } from '../../trading/signal'
import { TTLCache } from '../cache'
import { getMarketDb, marketDbExists } from './db'

export type { StrategyBundle, StrategyData, StrategyVersionDef } from '../../strategy/types'

// ==================== 策略模拟（A‴ 方案）数据服务（仅服务端，只读查询） ====================
// 版本化：条件参数集 = 版本（当前 v1）；改条件在 STRATEGY_VERSIONS 追加 v2/v3…（保留历史版本），
// 页面按版本回放并对比净值曲线，注册表末位 = 当前执行版本。
// 买入：概念热力日榜前 walkN 名逐个校验「周榜排名 weeks 周连升 + 板块内有候选」，
//       第一个双通过板块入选；候选 = 当日出 B 点（lib/trading/signal 的 dailySignals，
//       B/S 成对口径）且当日涨幅在 (pctLo, pctHi)；超 maxPick 只按均线比 MA30÷MA60 降序取前 N，资金均分。
// 卖出：收盘 < 买入价（保本止损）或收盘 ≥ 买入价×(1+takeProfit)（止盈），当日收盘价成交。
// v1 引擎口径与回测定型版一致（/tmp/bt 参数扫描结论：20/3 周/3~5%/前 3；止盈 2026-11-03 定版 12%）。

/* —— 策略版本注册表（改条件 = 在此追加新版本，勿改历史版本） —— */
/** 定型基线参数（/tmp/bt 参数扫描结论：20/3 周/3~5%/前 3），后续版本以此为基线覆盖差异项 */
const BASE_PARAMS = {
  walkN: 20,
  weeks: 3,
  pctLo: 3,
  pctHi: 5,
  takeProfit: 0.12,
  // 卖出（保本/止盈）也是版本参数：无缓冲保本（收盘 < 买入价即离场）
  stopBuffer: 0,
  maxPick: 3,
  // B 点口径也是版本参数（= signal.ts 定型默认）
  bPoint: { ...DEFAULT_B_POINT }
}
export const STRATEGY_VERSIONS: StrategyVersionDef[] = [
  {
    // 止盈 3%→12% 让利润奔跑（2026-11-03 定版；对照回测 07-13 起：12% +62.84%/回撤 6.58% vs 3% +53.77%/8.98%）
    id: 'v1',
    label: '止盈 12% 让利润奔跑（其余定型口径：日榜前 20 · 周榜 3 周连升 · 涨幅 3~5% · 保本 · 前 3 只）',
    start: '2026-11-02',
    params: BASE_PARAMS
  },
  {
    // 高胜率防守版（2026-11-03 定版，针对 03-24~07-31 亏损窗口七轮扫描 ~120 组收敛）：
    //   B 点 4 日 + 平高容差×1（过滤 3 日假动量 + 窗口判定宽容）· 候选涨幅 2.5~4%（买点前移）· 走查前 15 · 止盈 2.5%/缓冲 2%
    //   Q2 窗口 +64.89%/回撤 5.8%/胜率 81%（v1 同窗 -37.03%/39.5%/9%）；样本外 07-13~11-02 +10.81%/胜率 60%（v1 +62.84%，进攻性让渡）
    id: 'v2',
    label: '高胜率防守版：B点4日·平高 · 涨幅2.5~4% · 走查前15 · 止盈2.5%/缓冲2%',
    start: '2026-11-02',
    params: {
      walkN: 15,
      weeks: 3,
      pctLo: 2.5,
      pctHi: 4,
      takeProfit: 0.025,
      stopBuffer: 0.02,
      maxPick: 3,
      bPoint: { ...DEFAULT_B_POINT, runDays: 4, highTol: 1 }
    }
  }
  // 以后更改条件在此追加，例如：
  // { id: 'v3', label: '走查深度 15→30 + B 点窗口 4→5 日', start: '2026-11-02',
  //   params: { …BASE_PARAMS, walkN: 30, bPoint: { …DEFAULT_B_POINT, runDays: 5 } } }
]
export const ACTIVE_VERSION: StrategyVersionDef = STRATEGY_VERSIONS[STRATEGY_VERSIONS.length - 1] as StrategyVersionDef
const WARM_DAYS = 160 // 起始日前预热自然日（MA60 + 周榜快照回看 + 连涨链热身）
const STRATEGY_TTL_MS = 5 * 60 * 1000

interface BarRow {
  code: string
  trade_date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

interface CodeMeta {
  name: string
  /** 该股日 K 日期序列（升序） */
  dates: string[]
  closes: number[]
  /** 日期 → 当日涨幅（%，基准=该股上一根收盘） */
  pct: Map<string, number>
  /** 日期 → 均线比 MA30÷MA60（窗口不足无条目） */
  maRatio: Map<string, number>
  /** 日期 → 收盘价 */
  closeAt: Map<string, number>
  /** 起始日（含）之后的 B 点日期集合 */
  buys: Set<string>
}

const shiftDate = (d: string, days: number): string => {
  const dt = new Date(`${d}T00:00:00`)
  dt.setDate(dt.getDate() + days)
  const p = (x: number): string => `${x}`.padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

const tsOf = (d: string): number => new Date(`${d}T00:00:00`).getTime()

const hasTable = (db: DatabaseSync, name: string): boolean =>
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) != null

/** 计算策略模拟全量数据（market.db 只读；按版本定义回放；表缺失/数据不足返回 null）。
 *  候选池 = 全部启用股（停牌不参与：当日无 K 线则无收盘/B 点，不成候选、不进榜单均值）；
 *  概念榜单同用全启用股（同选股中心概念热力）。
 *  range = 时间范围覆盖（缺省 = 版本起始日 → 数据尽头）：from 覆盖起始日、to 截断回放（含端点；
 *  区间内无交易日/起始日前无预热数据返回 null）。 */
export const loadStrategy = (
  db: DatabaseSync,
  def: StrategyVersionDef,
  range?: StrategyRange | null
): StrategyData | null => {
  if (!hasTable(db, 'kline_daily') || !hasTable(db, 'stock_concepts')) {
    return null
  }
  const P = def.params
  const startInput = range?.from ?? def.start
  const endInput = range?.to ?? null

  // 交易日历与窗口
  const warm = shiftDate(startInput, -WARM_DAYS)
  const days = (
    db
      .prepare('SELECT DISTINCT trade_date FROM kline_daily WHERE trade_date >= ? ORDER BY trade_date')
      .all(warm) as Array<{
      trade_date: string
    }>
  ).map((r) => r.trade_date)
  const startIdx = days.findIndex((d) => d >= startInput)
  if (startIdx <= 0 || days.length < startIdx + 1) {
    return null // 起始日前无预热数据 / 无模拟日（起始日起仅 1 个交易日亦可回放）
  }
  const start = days[startIdx] as string
  const btDays = endInput != null ? days.slice(startIdx).filter((d) => d <= endInput) : days.slice(startIdx)
  const prevOf = new Map<string, string>()
  for (let i = 1; i < days.length; i++) {
    prevOf.set(days[i] as string, days[i - 1] as string)
  }
  /** 7 自然日前最近交易日（含当日；周榜快照锚点） */
  const baseAt = (cut: string): string | null => {
    for (let i = days.length - 1; i >= 0; i--) {
      if ((days[i] as string) <= cut) {
        return days[i] as string
      }
    }
    return null
  }

  // 名称与板块成分（启用股；一股一概念）
  const nameOf = new Map<string, string>()
  for (const r of db.prepare('SELECT code, name FROM stocks WHERE enabled = 1').all() as Array<{
    code: string
    name: string
  }>) {
    nameOf.set(r.code, r.name)
  }
  const membersOf = new Map<string, string[]>()
  for (const r of db
    .prepare(
      `SELECT sc.code, sc.concept_name FROM stock_concepts sc
       JOIN concepts c ON c.name = sc.concept_name
       JOIN stocks s ON s.code = sc.code AND s.enabled = 1`
    )
    .all() as Array<{ code: string; concept_name: string }>) {
    membersOf.set(r.concept_name, [...(membersOf.get(r.concept_name) ?? []), r.code])
  }

  // 逐股日 K + B 点（dailySignals 为纯函数，起始日前仅作计算上下文）
  const metaOf = new Map<string, CodeMeta>()
  const barRows = db
    .prepare(
      `SELECT code, trade_date, open, high, low, close, volume FROM kline_daily
       WHERE trade_date >= ? AND code IN (SELECT code FROM stocks WHERE enabled = 1)
       ORDER BY code, trade_date`
    )
    .all(warm) as unknown as BarRow[]
  const byCode = new Map<string, BarRow[]>()
  for (const r of barRows) {
    const list = byCode.get(r.code) ?? []
    list.push(r)
    byCode.set(r.code, list)
  }
  for (const [code, rs] of byCode) {
    const bars = rs.map((r) => ({
      timestamp: tsOf(r.trade_date),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume ?? undefined
    }))
    const meta: CodeMeta = {
      name: nameOf.get(code) ?? code,
      dates: rs.map((r) => r.trade_date),
      closes: rs.map((r) => r.close),
      pct: new Map(),
      maRatio: new Map(),
      closeAt: new Map(),
      buys: new Set()
    }
    let sum30 = 0
    let sum60 = 0
    for (let i = 0; i < rs.length; i++) {
      const date = rs[i]?.trade_date as string
      const close = rs[i]?.close as number
      meta.closeAt.set(date, close)
      if (i > 0) {
        const prev = rs[i - 1]?.close as number
        if (prev > 0) {
          meta.pct.set(date, (close / prev - 1) * 100)
        }
      }
      sum30 += close
      sum60 += close
      if (i >= 30) {
        sum30 -= rs[i - 30]?.close as number
      }
      if (i >= 60) {
        sum60 -= rs[i - 60]?.close as number
      }
      if (i >= 59) {
        meta.maRatio.set(date, sum30 / 30 / (sum60 / 60))
      }
    }
    for (const p of dailySignals(bars, start, P.bPoint)) {
      if (p.signal !== 'buy') {
        continue
      }
      const date = rs.find((r) => tsOf(r.trade_date) === p.timestamp)?.trade_date
      if (date != null) {
        meta.buys.add(date)
      }
    }
    metaOf.set(code, meta)
  }

  // 榜单记忆化：日期 → 有序 [(concept, avg)]（day=vs上一交易日；week=vs7自然日前）
  const rankMemo = new Map<string, Array<[string, number]>>()
  const rankAt = (date: string, kind: 'day' | 'week'): Array<[string, number]> => {
    const key = `${kind}:${date}`
    const hit = rankMemo.get(key)
    if (hit != null) {
      return hit
    }
    const base = kind === 'day' ? (prevOf.get(date) ?? null) : baseAt(shiftDate(date, -7))
    const arr: Array<[string, number]> = []
    if (base != null) {
      for (const [concept, members] of membersOf) {
        let n = 0
        let sum = 0
        for (const code of members) {
          const meta = metaOf.get(code)
          const c = meta?.closeAt.get(date)
          const p = meta?.closeAt.get(base)
          if (c != null && p != null && p > 0) {
            sum += (c / p - 1) * 100
            n++
          }
        }
        if (n > 0) {
          arr.push([concept, sum / n])
        }
      }
      arr.sort((a, b) => b[1] - a[1])
    }
    rankMemo.set(key, arr)
    return arr
  }
  const rankIndexOf = new Map<string, Map<string, number>>()
  const rankOf = (date: string, kind: 'day' | 'week'): Map<string, number> => {
    const key = `${kind}:${date}`
    let m = rankIndexOf.get(key)
    if (m == null) {
      m = new Map(rankAt(date, kind).map(([c], i) => [c, i + 1]))
      rankIndexOf.set(key, m)
    }
    return m
  }

  /** 某日某板块的候选（当日 B 点 + 涨幅区间内；停牌无当日 K 线自然出局） */
  const candidatesOf = (date: string, concept: string): StrategyBuy[] => {
    const out: StrategyBuy[] = []
    for (const code of membersOf.get(concept) ?? []) {
      const meta = metaOf.get(code)
      if (meta == null || !meta.buys.has(date)) {
        continue
      }
      const pct = meta.pct.get(date)
      const close = meta.closeAt.get(date)
      if (pct != null && close != null && pct > P.pctLo && pct < P.pctHi) {
        out.push({ code, name: meta.name, concept, pct, maRatio: meta.maRatio.get(date) ?? null, price: close })
      }
    }
    return out
  }

  interface RiseRow {
    rank: number
    concept: string
    dayAvg: number
    chain: Array<number | null>
    rD: number | null
    rising: boolean
  }
  /** 日榜前 walkN 的连升状态（快照：本周/上周/两周前；rising 含「今日较昨日上升」） */
  const riseInfoOf = (date: string): RiseRow[] => {
    const wPrevDay = prevOf.get(date) != null ? rankOf(prevOf.get(date) as string, 'week') : null
    return rankAt(date, 'day')
      .slice(0, P.walkN)
      .map(([concept, dayAvg], i) => {
        const rs: Array<number | null> = []
        for (let k = 0; k < P.weeks; k++) {
          const dk = k === 0 ? date : baseAt(shiftDate(date, -7 * k))
          rs.push(dk != null ? (rankOf(dk, 'week').get(concept) ?? null) : null)
        }
        const rD = wPrevDay?.get(concept) ?? null
        const rising =
          rs.every((x) => x != null) &&
          rD != null &&
          (rs[0] as number) < rD &&
          rs.every((x, k) => k === 0 || (x as number) > (rs[k - 1] as number))
        return { rank: i + 1, concept, dayAvg, chain: rs, rD, rising }
      })
  }

  // —— 组合模拟（先卖后买，卖出资金当日可用；收盘价成交） ——
  interface Position {
    code: string
    concept: string
    buyDate: string
    buyPrice: number
    qty: number
    cost: number
    lastClose: number
  }
  let cash = STRATEGY_CAPITAL
  const positions = new Map<string, Position>()
  const trades: StrategySell[] = []
  const days2: StrategyDay[] = []
  const equityCurve: Array<{ date: string; equity: number }> = []
  let marketValue = 0

  for (const D of btDays) {
    // 卖出：保本止损 / 止盈
    const sells: StrategySell[] = []
    for (const [code, p] of positions) {
      const meta = metaOf.get(code)
      const close = meta?.closeAt.get(D)
      if (close == null) {
        continue // 停牌：继续持有
      }
      p.lastClose = close
      // 卖出（版本参数）：保本止损线 = 买入价×(1−stopBuffer)（v1 无缓冲）；止盈线 = 买入价×(1+takeProfit)
      const reason: StrategySell['reason'] | null =
        close < p.buyPrice * (1 - P.stopBuffer)
          ? 'breakeven'
          : close >= p.buyPrice * (1 + P.takeProfit)
            ? 'takeprofit'
            : null
      if (reason == null) {
        continue
      }
      const proceeds = p.qty * close
      cash += proceeds
      trades.push({
        code,
        name: meta?.name ?? code,
        concept: p.concept,
        buyDate: p.buyDate,
        buyPrice: p.buyPrice,
        sellDate: D,
        sellPrice: close,
        holdDays: btDays.indexOf(D) - btDays.indexOf(p.buyDate),
        pnlPct: (close / p.buyPrice - 1) * 100,
        pnl: proceeds - p.cost,
        reason
      })
      sells.push(trades[trades.length - 1] as StrategySell)
      positions.delete(code)
    }

    // 买入：日榜前 WALK_N 逐名校验「连升 + 有候选」，资金均分
    const buys: StrategyBuy[] = []
    let selected: StrategyDay['selected'] = null
    if (cash > 1) {
      for (const row of riseInfoOf(D)) {
        if (!row.rising) {
          continue
        }
        const cands = candidatesOf(D, row.concept).filter((c) => !positions.has(c.code))
        if (cands.length === 0) {
          continue // 排名通过但无候选 → 看下一名
        }
        cands.sort((a, b) => (b.maRatio ?? -Infinity) - (a.maRatio ?? -Infinity))
        const picks = cands.slice(0, P.maxPick)
        const per = cash / picks.length
        for (const c of picks) {
          const qty = per / c.price
          positions.set(c.code, {
            code: c.code,
            concept: row.concept,
            buyDate: D,
            buyPrice: c.price,
            qty,
            cost: qty * c.price,
            lastClose: c.price
          })
          cash -= qty * c.price
          buys.push(c)
        }
        selected = {
          concept: row.concept,
          rank: row.rank,
          chain: [...row.chain]
            .reverse()
            .map((x) => x ?? '?')
            .join('→'),
          rD: row.rD
        }
        break
      }
    }

    // 结算净值
    marketValue = 0
    for (const [code, p] of positions) {
      const close = metaOf.get(code)?.closeAt.get(D)
      if (close != null) {
        p.lastClose = close
      }
      marketValue += p.qty * p.lastClose
    }
    const equity = cash + marketValue
    days2.push({ date: D, selected, buys, sells, cash, equity })
    equityCurve.push({ date: D, equity })
  }

  if (days2.length === 0) {
    return null
  }
  const lastDay = days2[days2.length - 1] as StrategyDay

  // 期末持仓视图
  const posView: StrategyPosition[] = [...positions.values()].map((p) => ({
    code: p.code,
    name: metaOf.get(p.code)?.name ?? p.code,
    concept: p.concept,
    buyDate: p.buyDate,
    buyPrice: p.buyPrice,
    lastClose: p.lastClose,
    floatPct: (p.lastClose / p.buyPrice - 1) * 100,
    value: p.qty * p.lastClose,
    toTp: ((p.buyPrice * (1 + P.takeProfit)) / p.lastClose - 1) * 100,
    toStop: (p.lastClose / (p.buyPrice * (1 - P.stopBuffer)) - 1) * 100
  }))

  // 最近交易日走查透视
  const walk: StrategyWalkRow[] = riseInfoOf(lastDay.date).map((row) => ({
    rank: row.rank,
    concept: row.concept,
    dayAvg: row.dayAvg,
    chain: [...row.chain]
      .reverse()
      .map((x) => x ?? '?')
      .join('→'),
    rD: row.rD,
    rising: row.rising,
    hasCand: candidatesOf(lastDay.date, row.concept).length > 0
  }))

  const equity = lastDay.equity
  return {
    meta: {
      version: def.id,
      versionLabel: def.label,
      startDate: start,
      lastDate: lastDay.date,
      tradingDays: days2.length,
      params: { ...P }
    },
    summary: {
      equity,
      cash: lastDay.cash,
      marketValue,
      returnPct: (equity / STRATEGY_CAPITAL - 1) * 100,
      closedCount: trades.length,
      winCount: trades.filter((t) => t.pnl > 0).length
    },
    equityCurve,
    days: days2,
    positions: posView,
    trades: [...trades].reverse(),
    latest: { date: lastDay.date, walk }
  }
}

const strategyCache = new TTLCache<StrategyData | null>({ maxEntries: 8, defaultTtlMs: STRATEGY_TTL_MS })

/** 安全读取（库未复制/数据不足/异常返回 null） */
export const loadStrategySafe = (def: StrategyVersionDef, range?: StrategyRange | null): StrategyData | null => {
  if (!marketDbExists()) {
    return null
  }
  try {
    return loadStrategy(getMarketDb(), def, range)
  } catch {
    return null
  }
}

/** 缓存版读取（按版本 id + 时间范围分键缓存；refresh=true 绕过缓存重算，冷算约数秒/版本）。 */
export const getStrategyVersion = async (
  def: StrategyVersionDef,
  refresh = false,
  range?: StrategyRange | null
): Promise<StrategyData | null> => {
  const rk = range != null && (range.from != null || range.to != null) ? `:${range.from ?? ''}~${range.to ?? ''}` : ''
  const key = refresh ? `market-db:strategy:${def.id}${rk}:${Date.now()}` : `market-db:strategy:${def.id}${rk}`
  const hit = strategyCache.get(key)
  if (hit !== undefined) {
    return hit
  }
  return strategyCache.getOrLoad(key, () => Promise.resolve(loadStrategySafe(def, range)), STRATEGY_TTL_MS)
}

/** 全版本数据束（SSR 首屏与 /api/strategy 共用；末位注册版本 = 当前执行；range 透传各版本统一覆盖） */
export const getStrategyBundle = async (refresh = false, range?: StrategyRange | null): Promise<StrategyBundle> => {
  const entries = await Promise.all(
    STRATEGY_VERSIONS.map(async (def) => [def.id, await getStrategyVersion(def, refresh, range)] as const)
  )
  return {
    active: ACTIVE_VERSION.id,
    order: STRATEGY_VERSIONS.map((def) => def.id),
    versions: Object.fromEntries(entries)
  }
}
