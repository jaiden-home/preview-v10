import type { DatabaseSync } from 'node:sqlite'
import type { BoardData, ConceptHeat, HeatPeriodKey, HeatPeriods, LeaderRow } from '../../screener/types'
import { TTLCache } from '../cache'
import { getMarketDb, marketDbExists } from './db'

export type { BoardData, BoardMeta, ConceptHeat, HeatPeriodKey, HeatPeriods, LeaderRow } from '../../screener/types'

// ==================== 领涨看板数据服务（仅服务端，只读查询） ====================
// 口径完整移植自 market 项目首页（src/app/page.tsx loadDashboard）：
// 概念热力四周期聚合 + 历史领涨聚合 + 趋势过滤 + B 点指标 + 本月进入标记。
// 判定常量与 market 项目保持一致；表缺失/空表返回 null（页面走引导空态）。

/* —— 领涨筛选口径（与 market/scripts/sync/leaders.mjs 对齐） —— */
const MA_NEED = 60 // 趋势过滤最少日 K 门槛（数据充分性）
const TREND_WEEK_RUN = 3 // 周线强涨链长度（自然交易周，当周进行中数据计入）

/* —— B 点（买入开仓）口径：纯条件信号不落表，实时算，改常量刷新即生效 ——
   B = 连涨链恰为第 3 日（run==3）且 close ≥ MA30 且 动能双下限同时满足。 */
const BUY_RUN_DAYS = 3
const BUY_HIGH_TOL = 0.999 // 当日 high ≥ 前日 high × 0.999（平高/针尖容差）
const BUY_TAIL_REPAIR_MIN = 0.5 // 下限1：R2+R3 ≥ R1 × 0.5（首日大涨后需有效修复）
const BUY_FADE_RATIO = 0.15 // 下限2：R3 ≥ R2 × 0.15（第 3 日动能不得衰竭至此以下）
const BUY_LOOKBACK_DAYS = 365 // 近 1 年窗口（自然日；另加 60 自然日余量供热身）

interface KlineStats {
  stocks: number
  filtered: number
  concepts: number
  lastDate: string
  prevDate: string | null
}

const shiftDate = (d: string, days: number): string => {
  const dt = new Date(`${d}T00:00:00`)
  dt.setDate(dt.getDate() + days)
  const p = (x: number): string => `${x}`.padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

/** 交易周标识：该日期所在自然周的周一（YYYY-MM-DD） */
const weekKeyOf = (d: string): string => {
  const dt = new Date(`${d}T00:00:00`)
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)) // 周一=0
  const p = (x: number): string => `${x}`.padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

const hasTable = (db: DatabaseSync, name: string): boolean =>
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) != null

/** 读取看板数据（只读查询；表缺失/空表返回 null） */
export const loadBoard = (db: DatabaseSync): BoardData | null => {
  if (!hasTable(db, 'kline_daily')) {
    return null
  }
  const st = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM stocks WHERE enabled = 1) stocks,
         (SELECT COUNT(*) FROM stocks WHERE enabled = 0) filtered,
         (SELECT COUNT(*) FROM concepts) concepts,
         (SELECT MAX(trade_date) FROM kline_daily) lastDate,
         (SELECT MAX(trade_date) FROM kline_daily WHERE trade_date < (SELECT MAX(trade_date) FROM kline_daily)) prevDate`
    )
    .get() as KlineStats | undefined
  if (st == null || st.lastDate == null || st.lastDate === '') {
    return null
  }
  const prevDate = st.prevDate ?? st.lastDate

  // ① 区间涨跌幅（启用股，基准 = 窗口起点前最后交易日收盘）
  interface PctRow {
    code: string
    name: string
    pct: number
  }
  const pctRowsStmt = db.prepare(
    `SELECT s.code, s.name,
            ROUND((kt.close - kp.close) / kp.close * 10000) / 100.0 AS pct
     FROM stocks s
     JOIN kline_daily kt ON kt.code = s.code AND kt.trade_date = ?
     JOIN kline_daily kp ON kp.code = s.code AND kp.trade_date = ?
     WHERE s.enabled = 1`
  )
  const baseAtStmt = db.prepare('SELECT MAX(trade_date) d FROM kline_daily WHERE trade_date <= ?')
  const rowsFor = (base: string): PctRow[] =>
    base < st.lastDate ? (pctRowsStmt.all(st.lastDate, base) as unknown as PctRow[]) : []
  const baseAt = (cut: string): string => (baseAtStmt.get(cut) as { d: string | null } | undefined)?.d ?? ''

  // ② 概念映射（code -> 概念名 + 所属大类；自定义体系：一股一概念）
  interface ConceptPair {
    code: string
    concept_name: string
    category: string
  }
  const pairs = db
    .prepare(
      `SELECT sc.code, sc.concept_name, c.category FROM stock_concepts sc
       JOIN concepts c ON c.name = sc.concept_name
       JOIN stocks s ON s.code = sc.code AND s.enabled = 1`
    )
    .all() as unknown as ConceptPair[]
  const conceptsOf = new Map<string, string[]>()
  const categoryOf = new Map<string, string>()
  const catOfConcept = new Map<string, string>()
  for (const p of pairs) {
    conceptsOf.set(p.code, [...(conceptsOf.get(p.code) ?? []), p.concept_name])
    categoryOf.set(p.code, p.category)
    catOfConcept.set(p.concept_name, p.category)
  }
  const categories = (
    db.prepare('SELECT category FROM concepts GROUP BY category ORDER BY MIN(sort)').all() as Array<{
      category: string
    }>
  ).map((r) => r.category)

  // ③ 概念聚合：涨家数/等权均值/全概念区间领涨（热力图四周期）
  interface Agg {
    cnt: number
    upCnt: number
    sum: number
    leader: { code: string; name: string; pct: number } | null
  }
  const aggregate = (rows: PctRow[]): ConceptHeat[] => {
    const agg = new Map<string, Agg>()
    for (const r of rows) {
      for (const cc of conceptsOf.get(r.code) ?? []) {
        const a = agg.get(cc) ?? { cnt: 0, upCnt: 0, sum: 0, leader: null }
        a.cnt++
        a.sum += r.pct
        if (r.pct > 0) a.upCnt++
        if (a.leader == null || r.pct > a.leader.pct) a.leader = { code: r.code, name: r.name, pct: r.pct }
        agg.set(cc, a)
      }
    }
    return [...agg.entries()]
      .map(([name, a]) => ({
        code: name,
        name,
        category: catOfConcept.get(name) ?? '其他',
        n: a.cnt,
        up: a.upCnt,
        evalN: a.cnt,
        avgPct: a.cnt > 0 ? a.sum / a.cnt : 0,
        leader: a.leader
      }))
      .filter((c) => c.evalN > 0)
      .sort((a, b) => b.avgPct - a.avgPct)
  }
  // 周期窗口：日 = 昨收；周/月/年 = 近 7/30/365 自然日（基准 = 窗口起点前最后交易日收盘）
  const periodDefs: Array<[HeatPeriodKey, string]> = [
    ['day', prevDate],
    ['week', baseAt(shiftDate(st.lastDate, -7))],
    ['month', baseAt(shiftDate(st.lastDate, -30))],
    ['year', baseAt(shiftDate(st.lastDate, -365))]
  ]
  const periods = {} as HeatPeriods
  for (const [k, base] of periodDefs) periods[k] = aggregate(rowsFor(base))

  // ④ 历史领涨股聚合（leader_events；表缺失/空时为空数组）
  const hasLeaders = hasTable(db, 'leader_events')
  interface AggRow {
    code: string
    name: string
    board: string
    exchange: string
    days: number
    events: number
    lastDate: string
  }
  const aggRows: AggRow[] = hasLeaders
    ? (db
        .prepare(
          `SELECT e.code, s.name, s.board, s.exchange,
                  COUNT(DISTINCT e.trade_date) days, COUNT(*) events, MAX(e.trade_date) lastDate
           FROM leader_events e JOIN stocks s ON s.code = e.code AND s.enabled = 1
           GROUP BY e.code`
        )
        .all() as unknown as AggRow[])
    : []

  // 每股全部领涨概念（热力联动/搜索用）——按**当前归属**（stock_concepts → conceptsOf）归组：
  // 口径同 sync:leaders「历史成分变动不可考，以当前快照回看历史」，划转/改名后看板即时跟随；
  // 不再读 leader_events 留档概念名（该表仅在 scripts 重算时按当时映射重建，会与本表口径漂移）；
  // 行内 category（当前概念所属大类）同源 conceptsOf，两字段永远一致。未归类领涨股 concepts 为空。
  const conceptListOf = new Map<string, string[]>()
  for (const a of aggRows) {
    const current = conceptsOf.get(a.code)
    if (current != null) {
      conceptListOf.set(a.code, current)
    }
  }

  // 一年领涨天数（近 365 自然日）
  const days365Map = new Map<string, number>()
  if (aggRows.length > 0) {
    const d365 = db
      .prepare(
        'SELECT e.code, COUNT(DISTINCT e.trade_date) days FROM leader_events e WHERE e.trade_date > ? GROUP BY e.code'
      )
      .all(shiftDate(st.lastDate, -365)) as Array<{ code: string; days: number }>
    for (const r of d365) days365Map.set(r.code, r.days)
  }

  // ⑤⑥ 趋势过滤 + B 点指标：候选股拉近 1 年 + 60 自然日余量日 K，逐股单次滚动
  const codes = aggRows.map((a) => a.code)
  const trendPass = new Set<string>()
  const firstTdMap = new Map<string, string>() // 上市日近似（次新过滤用）
  const lastBuy = new Map<string, string>()
  const streakMap = new Map<string, number>()
  const highStreakMap = new Map<string, number>()
  const fastFlipSet = new Set<string>()
  const trendDaysMap = new Map<string, number>()
  const buyStreakMap = new Map<string, number>()
  const pctMap = new Map<string, number>()
  const maRatioMap = new Map<string, number>()
  const priceMap = new Map<string, number>()
  const highHalfMap = new Map<string, number>()
  const highYearMap = new Map<string, number>()
  const limitCntMap = new Map<string, number>()
  if (codes.length > 0) {
    const boardOf = new Map(aggRows.map((a) => [a.code, a.board] as const))
    const ph = codes.map(() => '?').join(',')
    for (const r of db
      .prepare(`SELECT code, MIN(trade_date) d FROM kline_daily WHERE code IN (${ph}) GROUP BY code`)
      .all(...codes) as Array<{ code: string; d: string }>) {
      firstTdMap.set(r.code, r.d)
    }
    interface BarRow {
      code: string
      trade_date: string
      high: number
      low: number
      close: number
    }
    const bars = db
      .prepare(
        `SELECT code, trade_date, high, low, close FROM kline_daily
         WHERE trade_date > ? AND code IN (${ph}) ORDER BY code, trade_date`
      )
      .all(shiftDate(st.lastDate, -(BUY_LOOKBACK_DAYS + 60)), ...codes) as unknown as BarRow[]
    interface Week {
      k: string
      c: number
      lo: number
    }
    interface Roll {
      code: string
      bars: number
      lastTd: string
      lastPct: number | null
      maQ: number[]
      ma30Sum: number
      ma60Sum: number
      cntAbove60: number
      cntGolden: number
      goldenIn: number
      maxGolden: number
      prevHigh: number | null
      prevClose: number | null
      run: number
      pcts: number[]
      chain: number
      highChain: number
      buyOnPrevDay: boolean
      afterOn: boolean
      afterChain: number
      afterBroken: boolean
      weeks: Week[]
      wCur: Week | null
      lastClose: number | null
      maxHalf: number
      maxYear: number
      limitCnt: number
    }
    const cutHalf = shiftDate(st.lastDate, -182)
    const cutYear = shiftDate(st.lastDate, -365)
    let cur: Roll | null = null
    const finalize = (c: Roll | null): void => {
      if (c == null) return
      streakMap.set(c.code, c.chain)
      highStreakMap.set(c.code, c.highChain)
      if (c.cntGolden > 15 && c.cntAbove60 > 15) {
        fastFlipSet.add(c.code)
      }
      if (c.lastClose != null) priceMap.set(c.code, c.lastClose)
      if (c.maxHalf > 0) highHalfMap.set(c.code, c.maxHalf)
      if (c.maxYear > 0) highYearMap.set(c.code, c.maxYear)
      if (c.lastPct != null) pctMap.set(c.code, c.lastPct)
      if (c.maxGolden > 0) trendDaysMap.set(c.code, c.maxGolden)
      if (c.limitCnt > 0) limitCntMap.set(c.code, c.limitCnt)
      if (lastBuy.has(c.code)) buyStreakMap.set(c.code, c.afterChain)
      if (c.maQ.length >= 60) maRatioMap.set(c.code, c.ma30Sum / 30 / (c.ma60Sum / 60))
      // 周线强涨链：最新周续链 = 收盘不低于上周最低价；更早各周 = 收盘 > 上周收盘
      const ws = [...c.weeks, ...(c.wCur != null ? [c.wCur] : [])]
      let wRun = ws.length > 0 ? 1 : 0
      for (let i = ws.length - 2; i >= 0; i--) {
        const linked = i === ws.length - 2 ? ws[i + 1]!.c >= ws[i]!.lo : ws[i + 1]!.c > ws[i]!.c
        if (linked) wRun++
        else break
      }
      // 均线规则：收盘需站上 MA30/MA60 中较低者（MA 不可算时不拦截，由 ≥60 根门槛兜底）
      let maOk = true
      if (c.maQ.length >= 60) {
        const ma30 = c.ma30Sum / 30
        const ma60 = c.ma60Sum / 60
        if (ma60 > ma30) maOk = c.lastClose != null && c.lastClose > ma30
        else if (ma60 < ma30) maOk = c.lastClose != null && c.lastClose > ma60
      }
      const listedOk = (firstTdMap.get(c.code) ?? '') <= cutYear
      if (c.bars >= MA_NEED && listedOk && c.lastTd === st.lastDate && wRun >= TREND_WEEK_RUN && maOk) {
        trendPass.add(c.code)
      }
    }
    for (const b of bars) {
      if (cur == null || cur.code !== b.code) {
        finalize(cur)
        cur = {
          code: b.code,
          bars: 0,
          lastTd: '',
          lastPct: null,
          maQ: [],
          ma30Sum: 0,
          ma60Sum: 0,
          cntAbove60: 0,
          cntGolden: 0,
          goldenIn: 0,
          maxGolden: 0,
          prevHigh: null,
          prevClose: null,
          run: 0,
          pcts: [],
          chain: 0,
          highChain: 0,
          buyOnPrevDay: false,
          afterOn: false,
          afterChain: 0,
          afterBroken: false,
          weeks: [],
          wCur: null,
          lastClose: null,
          maxHalf: 0,
          maxYear: 0,
          limitCnt: 0
        }
      }
      cur.bars++
      cur.lastTd = b.trade_date
      cur.lastClose = b.close
      if (b.trade_date > cutHalf) {
        if (b.high > cur.maxHalf) cur.maxHalf = b.high
        if (b.high > cur.maxYear) cur.maxYear = b.high // 半年 ⊂ 一年，一并累计
      } else if (b.trade_date > cutYear && b.high > cur.maxYear) {
        cur.maxYear = b.high
      }
      // MA30/MA60 双滚窗（同一队列）+ 趋势向上计数
      cur.maQ.push(b.close)
      cur.ma30Sum += b.close
      cur.ma60Sum += b.close
      if (cur.maQ.length > 30) cur.ma30Sum -= cur.maQ[cur.maQ.length - 31]!
      if (cur.maQ.length > 60) cur.ma60Sum -= cur.maQ.shift()!
      const ma30 = cur.maQ.length >= 30 ? cur.ma30Sum / 30 : null
      if (cur.maQ.length >= 60) {
        const ma60 = cur.ma60Sum / 60
        cur.cntAbove60 = b.close > ma60 ? cur.cntAbove60 + 1 : 0
        const golden = ma30! > ma60
        cur.cntGolden = golden ? cur.cntGolden + 1 : 0
        // 趋势天数：仅近 1 年窗内累计（窗前 bar 只供热身）
        if (b.trade_date > cutYear) {
          cur.goldenIn = golden ? cur.goldenIn + 1 : 0
          if (cur.goldenIn > cur.maxGolden) cur.maxGolden = cur.goldenIn
        }
      }
      // 交易周累积（k = 周一；当周进行中 close 取周内最新、lo 取周内最低）
      const wk = weekKeyOf(b.trade_date)
      if (cur.wCur != null && cur.wCur.k === wk) {
        cur.wCur.c = b.close
        if (b.low < cur.wCur.lo) cur.wCur.lo = b.low
      } else {
        if (cur.wCur != null) {
          cur.weeks.push(cur.wCur)
          if (cur.weeks.length > 4) cur.weeks.shift()
        }
        cur.wCur = { k: wk, c: b.close, lo: b.low }
      }

      if (cur.prevClose != null && cur.prevClose > 0) {
        const pct = b.close / cur.prevClose - 1 // R（小数）
        cur.lastPct = pct * 100
        // 一年涨停次数：与昨收比达板别涨停幅度（容差 0.05）
        if (b.trade_date > cutYear && pct * 100 >= ((boardOf.get(b.code) ?? 'main') === 'gem' ? 20 : 10) - 0.05) {
          cur.limitCnt++
        }
        cur.pcts.push(pct)
        if (cur.pcts.length > BUY_RUN_DAYS) cur.pcts.shift()
        // 连涨链：high 容差 0.999 平高不断链；收盘必须过前收
        const chained = cur.prevHigh != null && b.high >= cur.prevHigh * BUY_HIGH_TOL && b.close > cur.prevClose
        cur.run = chained ? cur.run + 1 : 0
        cur.chain = b.close > cur.prevClose ? cur.chain + 1 : 0
        cur.highChain = cur.prevHigh != null && b.high > cur.prevHigh ? cur.highChain + 1 : 0
        // B 点连涨：昨日为 B → 今日起计数；断链冻结
        if (cur.buyOnPrevDay) {
          cur.buyOnPrevDay = false
          cur.afterOn = true
          cur.afterChain = 0
          cur.afterBroken = false
        }
        if (cur.afterOn && !cur.afterBroken) {
          if (b.close > cur.prevClose) cur.afterChain++
          else cur.afterBroken = true
        }
        // B 判定限近 1 年窗内（cutYear），预热区只供热身
        if (
          b.trade_date > cutYear &&
          cur.run === BUY_RUN_DAYS &&
          ma30 != null &&
          b.close >= ma30 &&
          cur.pcts.length === BUY_RUN_DAYS
        ) {
          const [r1, r2, r3] = cur.pcts as [number, number, number]
          const okRepair = r2 + r3 >= r1 * BUY_TAIL_REPAIR_MIN
          const okFade = r3 >= r2 * BUY_FADE_RATIO
          if (okRepair && okFade) {
            lastBuy.set(b.code, b.trade_date) // 后出现覆盖 → 窗口内最后一个
            cur.buyOnPrevDay = true
            cur.afterOn = false
            cur.afterChain = 0
            cur.afterBroken = false
          }
        }
      }
      cur.prevHigh = b.high
      cur.prevClose = b.close
    }
    finalize(cur)
  }

  // ⑦ 本月进入标记：回放上月末→本月逐日趋势过滤状态（仅对趋势达标股）
  const joinInfo = new Map<string, { isNew: boolean; joinDate: string | null }>()
  if (trendPass.size > 0) {
    const monthStart = `${st.lastDate.slice(0, 8)}01`
    const monthFirst = (
      db.prepare('SELECT MIN(trade_date) d FROM kline_daily WHERE trade_date >= ?').get(monthStart) as
        { d: string } | undefined
    )?.d
    if (monthFirst != null) {
      const baseDate = (
        db.prepare('SELECT MAX(trade_date) d FROM kline_daily WHERE trade_date < ?').get(monthFirst) as
          { d: string } | undefined
      )?.d
      if (baseDate != null) {
        const monthDays = (
          db
            .prepare(
              'SELECT DISTINCT trade_date d FROM kline_daily WHERE trade_date >= ? AND trade_date <= ? ORDER BY d'
            )
            .all(monthFirst, st.lastDate) as Array<{ d: string }>
        ).map((r) => r.d)
        const pcodes = [...trendPass]
        const ph2 = pcodes.map(() => '?').join(',')
        interface HistRow {
          code: string
          trade_date: string
          close: number
        }
        const hist = db
          .prepare(
            `SELECT code, trade_date, close FROM kline_daily
             WHERE trade_date > ? AND code IN (${ph2}) ORDER BY code, trade_date`
          )
          .all(shiftDate(baseDate, -180), ...pcodes) as unknown as HistRow[]
        const wRunOf = (weeks: Array<{ k: string; c: number }>, wCur: { k: string; c: number } | null): number => {
          const ws = [...weeks, ...(wCur != null ? [wCur] : [])]
          let run = ws.length > 0 ? 1 : 0
          for (let i = ws.length - 2; i >= 0; i--) {
            if (ws[i + 1]!.c > ws[i]!.c) run++
            else break
          }
          return run
        }
        interface JoinRoll {
          code: string
          bars: number
          weeks: Array<{ k: string; c: number }>
          wCur: { k: string; c: number } | null
          maQ: number[]
          ma30Sum: number
          ma60Sum: number
          passByDate: Map<string, boolean>
        }
        let jc: JoinRoll | null = null
        const finalizeJoin = (c: JoinRoll | null): void => {
          if (c == null) return
          const basePass = c.passByDate.get(baseDate) ?? false // 基准日无 bar（停牌）= 不在名单
          let firstEnter: string | null = null
          let reEnter: string | null = null
          let dropped = false
          for (const t of monthDays) {
            const p = c.passByDate.get(t) ?? false
            if (!basePass) {
              if (p && firstEnter == null) firstEnter = t
            } else if (!p) {
              dropped = true
            } else if (dropped) {
              reEnter = t
              dropped = false
            }
          }
          joinInfo.set(c.code, { isNew: !basePass && firstEnter != null, joinDate: !basePass ? firstEnter : reEnter })
        }
        for (const b of hist) {
          if (jc == null || jc.code !== b.code) {
            finalizeJoin(jc)
            jc = {
              code: b.code,
              bars: 0,
              weeks: [],
              wCur: null,
              maQ: [],
              ma30Sum: 0,
              ma60Sum: 0,
              passByDate: new Map()
            }
          }
          jc.bars++
          jc.maQ.push(b.close)
          jc.ma30Sum += b.close
          jc.ma60Sum += b.close
          if (jc.maQ.length > 30) jc.ma30Sum -= jc.maQ[jc.maQ.length - 31]!
          if (jc.maQ.length > 60) jc.ma60Sum -= jc.maQ.shift()!
          const wk = weekKeyOf(b.trade_date)
          if (jc.wCur != null && jc.wCur.k === wk) {
            jc.wCur.c = b.close
          } else {
            if (jc.wCur != null) {
              jc.weeks.push(jc.wCur)
              if (jc.weeks.length > 4) jc.weeks.shift()
            }
            jc.wCur = { k: wk, c: b.close }
          }
          let maOk = true
          if (jc.maQ.length >= 60) {
            const ma30 = jc.ma30Sum / 30
            const ma60 = jc.ma60Sum / 60
            if (ma60 > ma30) maOk = b.close > ma30
            else if (ma60 < ma30) maOk = b.close > ma60
          }
          const listedOk = (firstTdMap.get(jc.code) ?? '') <= shiftDate(b.trade_date, -365)
          jc.passByDate.set(
            b.trade_date,
            jc.bars >= MA_NEED && listedOk && wRunOf(jc.weeks, jc.wCur) >= TREND_WEEK_RUN && maOk
          )
        }
        finalizeJoin(jc)
      }
    }
  }

  const leaders: LeaderRow[] = aggRows
    .filter((a) => trendPass.has(a.code))
    .map((a) => ({
      code: a.code,
      name: a.name,
      exchange: a.exchange,
      days: a.days,
      days365: days365Map.get(a.code) ?? 0,
      events: a.events,
      lastDate: a.lastDate,
      concepts: conceptListOf.get(a.code) ?? [],
      category: categoryOf.get(a.code) ?? null,
      pct: pctMap.get(a.code) ?? null,
      lastBuy: lastBuy.get(a.code) ?? null,
      streak: streakMap.get(a.code) ?? 0,
      highStreak: highStreakMap.get(a.code) ?? 0,
      fastFlip: fastFlipSet.has(a.code),
      buyStreak: lastBuy.has(a.code) ? (buyStreakMap.get(a.code) ?? 0) : null,
      maRatio: maRatioMap.get(a.code) ?? null,
      trendDays: trendDaysMap.get(a.code) ?? 0,
      price: priceMap.get(a.code) ?? null,
      highHalf: highHalfMap.get(a.code) ?? null,
      highYear: highYearMap.get(a.code) ?? null,
      limitUp365: limitCntMap.get(a.code) ?? 0,
      isNew: joinInfo.get(a.code)?.isNew ?? false,
      joinDate: joinInfo.get(a.code)?.joinDate ?? null
    }))
    .sort((a, b) => b.days - a.days || b.lastDate.localeCompare(a.lastDate))

  const countOf = (sql: string): number => (db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0

  return {
    meta: {
      lastDate: st.lastDate,
      stocks: st.stocks,
      concepts: st.concepts,
      filtered: st.filtered,
      leaderStocks: hasLeaders ? countOf('SELECT COUNT(DISTINCT code) n FROM leader_events') : 0,
      leaderDays: hasLeaders ? countOf('SELECT COUNT(DISTINCT trade_date) n FROM leader_events') : 0
    },
    periods,
    leaders,
    categories
  }
}

/** 看板进程内缓存（EOD 快照数据，5min 复用；SSR 与 API 共享；强制刷新绕过缓存重算） */
const BOARD_TTL_MS = 5 * 60 * 1000
const boardCache = new TTLCache<BoardData | null>({ maxEntries: 2, defaultTtlMs: BOARD_TTL_MS })

/** 安全读取看板（库未复制/异常返回 null） */
export const loadBoardSafe = (): BoardData | null => {
  if (!marketDbExists()) {
    return null
  }
  try {
    return loadBoard(getMarketDb())
  } catch {
    return null
  }
}

/** 缓存版看板读取（SSR 首屏与 /api/screener/board 共用；refresh=true 绕过缓存重算，冷算约数秒） */
export const getBoard = (refresh = false): Promise<BoardData | null> =>
  boardCache.getOrLoad(
    refresh ? `market-db:board:${Date.now()}` : 'market-db:board',
    () => Promise.resolve(loadBoardSafe()),
    BOARD_TTL_MS
  )

/** 使看板缓存失效（概念/成分写入后由管理域调用，下一次读取重算） */
export const invalidateBoardCache = (): void => {
  boardCache.delete('market-db:board')
}
