// sync:leaders —— leader_events 概念领涨事件计算（L4 日级衍生表，本地库自算，零外部请求；移植自 market 项目，口径一致）
//
// 用法：npm run task -- run sync:leaders [--from=YYYY-MM-DD]
//   默认增量：自事件表最大日起重算（含该日，幂等；零事件日重算成本低）
//   --from 强制重算该日（含）之后——口径变更后重建用
//
// 判定口径（与 market 项目 / 领涨看板一致）：
//   板块上涨 = 概念内当日有成交的启用股 上涨家数占比 > 50% 且 等权平均涨幅 > 3%
//   领涨 = 涨停（主板 10% / 创业板 20%，与昨收比对，容差 0.05）或 概念×市场涨幅第一（并列都算）
//   概念启用成分总数 < 5 → 仅涨停算领涨
//   范围 = 当前 enabled=1 股票（历史 ST 戴帽/概念成分变动不可考，以当前快照回看历史）
//
// 流程：逐年分块拉 K 线（防 15M 行全量进内存）→ JS 逐日聚合 → 逐日事务（DELETE 当日 + INSERT）
// 幂等：任意时刻重跑自动续传（起点=事件表最大日）
import { openDb, loadTaskState } from '../lib/db.mjs'

const AVG_MIN = 3 // 板块上涨：等权平均涨幅下限（%）
const UP_RATIO_MIN = 0.5 // 板块上涨：上涨家数占比下限
const MIN_STOCKS = 5 // 概念启用成分 < 5 只 → 仅涨停算领涨
const LIMIT_PCT = { main: 10, gem: 20 } // 涨停幅度

export async function run(args = []) {
  const opt = Object.fromEntries(
    args.map((a) =>
      a.startsWith('--') ? [a.slice(2).split('=')[0], a.includes('=') ? a.split('=')[1] : true] : [a, true]
    )
  )
  const forceFrom = typeof opt.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opt.from) ? opt.from : null

  const db = openDb()
  for (const t of ['stocks', 'concepts', 'stock_concepts', 'kline_daily', 'leader_events']) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t)) {
      console.error(`${t} 表不存在：market.db 快照不完整（本项目不自建表，请自 market 项目重新复制）`)
      process.exit(1)
    }
  }
  const nK = db.prepare('SELECT COUNT(*) n FROM kline_daily').get().n
  if (nK === 0) {
    console.error('kline_daily 为空，请先执行：npm run task -- run sync:kline-daily')
    process.exit(1)
  }

  // 股票池（enabled=1）与概念映射 / 成分总数（自定义体系：一股一概念，全表即现状）
  const stock = new Map(
    db
      .prepare('SELECT code, exchange, board FROM stocks WHERE enabled = 1')
      .all()
      .map((r) => [r.code, r])
  )
  const conceptsOf = new Map()
  const memberTotal = new Map()
  for (const { code, concept_name } of db
    .prepare(
      `SELECT sc.code, sc.concept_name FROM stock_concepts sc
       JOIN stocks s ON s.code = sc.code AND s.enabled = 1`
    )
    .all()) {
    if (!conceptsOf.has(code)) conceptsOf.set(code, [])
    conceptsOf.get(code).push(concept_name)
    memberTotal.set(concept_name, (memberTotal.get(concept_name) ?? 0) + 1)
  }

  // 计算范围：全局交易日列表。增量起点 = min(事件表最大日, kline 水位线 final_through)——
  // 补数部分失败时事件最大日可能已越过缺口日（当日快照先行落库），取水位线兜底保证缺口日事件被重算。
  const dates = db
    .prepare('SELECT DISTINCT trade_date d FROM kline_daily ORDER BY d')
    .all()
    .map((r) => r.d)
  const evMax = db.prepare('SELECT MAX(trade_date) d FROM leader_events').get().d
  const finalThrough = loadTaskState()['sync:kline-daily']?.final_through ?? null
  const incStart = evMax ?? dates[0]
  // 日期为 YYYY-MM-DD 字符串，比较必须用字符串序（Math.min 对日期串会得 NaN）
  const startFrom = forceFrom ?? (finalThrough != null && finalThrough < incStart ? finalThrough : incStart)
  const todo = dates.filter((d) => d >= startFrom)
  const fromWhy = forceFrom
    ? '--from 强制'
    : finalThrough != null && finalThrough < incStart
      ? `增量（水位线 ${finalThrough} 重算起，覆盖缺口日）`
      : evMax
        ? `增量（事件表最大日 ${evMax} 重算起）`
        : '全量回填'
  console.log(
    `① 计算范围：${todo[0]} ~ ${todo[todo.length - 1]}（${todo.length} 个交易日；${fromWhy}）· 股票池 ${stock.size} 只 · 概念 ${memberTotal.size} 个`
  )

  // 逐年分块（跨块传递 prevClose，保证块首日 pct 基准正确）
  const insEvent = db.prepare(
    `INSERT INTO leader_events (code, concept_name, exchange, trade_date, pct, reason, concept_avg, concept_up_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const delDay = db.prepare('DELETE FROM leader_events WHERE trade_date = ?')
  const pull = db.prepare(
    'SELECT code, trade_date, close FROM kline_daily WHERE trade_date BETWEEN ? AND ? ORDER BY trade_date'
  )

  let prevClose = new Map() // code -> 前一全局交易日收盘
  let totalEvents = 0
  let totalDays = 0
  const t0 = Date.now()

  for (let i = 0; i < todo.length;) {
    // 块 = 同一年
    const year = todo[i].slice(0, 4)
    let j = i
    while (j < todo.length && todo[j].slice(0, 4) === year) j++
    const chunkDates = todo.slice(i, j)
    i = j

    // 块首日的 pct 基准 = 全局日历上前一日（可能在上一年）
    const startD = chunkDates[0]
    const gIdx = dates.indexOf(startD)
    if (gIdx > 0) {
      prevClose = new Map(
        db
          .prepare('SELECT code, close FROM kline_daily WHERE trade_date = ?')
          .all(dates[gIdx - 1])
          .map((r) => [r.code, r.close])
      )
    } else {
      prevClose = new Map() // 全历史首日无基准
    }

    // 拉块（只留股票池内的行）
    const rows = pull.all(startD, chunkDates[chunkDates.length - 1])
    const byDate = new Map() // date -> [[code, close], ...]
    for (const r of rows) {
      if (!stock.has(r.code)) continue
      if (!byDate.has(r.trade_date)) byDate.set(r.trade_date, [])
      byDate.get(r.trade_date).push([r.code, r.close])
    }

    let yearEvents = 0
    let yearDays = 0
    for (const d of chunkDates) {
      const dayRows = byDate.get(d) ?? []
      // 当日涨跌幅（需昨收）
      const pctMap = new Map()
      const closeMap = new Map()
      for (const [code, close] of dayRows) {
        closeMap.set(code, close)
        const pc = prevClose.get(code)
        if (pc > 0) pctMap.set(code, ((close - pc) / pc) * 100)
      }
      prevClose = closeMap

      // 概念聚合 + 概念×市场涨幅第一
      const agg = new Map() // cc -> [sum, cnt, upCnt]
      const maxPct = new Map() // cc|ex -> max pct
      for (const [code, pct] of pctMap) {
        for (const cc of conceptsOf.get(code) ?? []) {
          const a = agg.get(cc) ?? [0, 0, 0]
          a[0] += pct
          a[1]++
          if (pct > 0) a[2]++
          agg.set(cc, a)
          const k = `${cc}|${stock.get(code).exchange}`
          if (pct > (maxPct.get(k) ?? -Infinity)) maxPct.set(k, pct)
        }
      }
      // 板块上涨判定 → 领涨事件
      const events = []
      for (const [code, pct] of pctMap) {
        const { exchange, board } = stock.get(code)
        for (const cc of conceptsOf.get(code) ?? []) {
          const a = agg.get(cc)
          const avg = a[0] / a[1]
          if (!(a[2] / a[1] > UP_RATIO_MIN && avg > AVG_MIN)) continue // 板块未上涨
          const up = pct >= (LIMIT_PCT[board] ?? 10) - 0.05
          const top = pct >= (maxPct.get(`${cc}|${exchange}`) ?? Infinity) - 1e-9
          const small = (memberTotal.get(cc) ?? 0) < MIN_STOCKS
          if (up || (top && !small)) {
            events.push([
              code,
              cc,
              exchange,
              d,
              +pct.toFixed(2),
              [up ? 'limit' : null, top ? 'top' : null].filter(Boolean).join('+'),
              +avg.toFixed(2),
              +(a[2] / a[1]).toFixed(3)
            ])
          }
        }
      }
      // 逐日事务：DELETE 当日 + INSERT（幂等，含零事件日）
      db.exec('BEGIN')
      try {
        delDay.run(d)
        for (const e of events) insEvent.run(...e)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      yearEvents += events.length
      if (events.length) yearDays++
    }
    totalEvents += yearEvents
    totalDays += yearDays
    console.log(
      `   ${year}：事件 ${yearEvents} 条 · 领涨日 ${yearDays} 天 · 累计 ${totalEvents} 条（${(
        (Date.now() - t0) /
        1000
      ).toFixed(0)}s）`
    )
  }

  // 摘要
  const st = db
    .prepare(
      `SELECT COUNT(*) events, COUNT(DISTINCT code) stocks, COUNT(DISTINCT trade_date) days,
              MIN(trade_date) lo, MAX(trade_date) hi FROM leader_events`
    )
    .get()
  console.log(
    `② 摘要：本次写入 ${totalEvents} 条事件（${totalDays} 个领涨日）· 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`
  )
  console.log(
    `   leader_events 现存 ${st.events} 条 · 覆盖 ${st.stocks} 只股票 · ${st.days} 个领涨日 · ${st.lo} ~ ${st.hi}`
  )
  const top = db
    .prepare(
      `SELECT e.code, s.name, COUNT(DISTINCT e.trade_date) days FROM leader_events e
       JOIN stocks s ON s.code = e.code GROUP BY e.code ORDER BY days DESC LIMIT 5`
    )
    .all()
  console.log(`   领涨天数 Top5：${top.map((r) => `${r.name}(${r.days}天)`).join('、')}`)
  db.close()
}
