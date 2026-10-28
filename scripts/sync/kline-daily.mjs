// sync:kline-daily —— kline_daily 同步任务（L4 日级，任意时刻可跑，幂等；快照/日历=腾讯源与 BFF 同上游，补数=新浪源）
//
// 用法：npm run task -- run sync:kline-daily [--status]
//   --status：只读查看数据完整性（不请求行情、不写库）
//
// 行为（自动兼容漏跑交易日，无需单独补数命令）：
//   ① 市场状态：sh000001 实时行情时间戳 → 今日是否交易日 / 是否已收盘（≥15:00）
//   ② 交易日历：sh000001 日K 日期序列（腾讯权威日历）
//   ③ 漏跑补数：final_through（状态文件）之后的交易日缺口 → 逐股拉新浪全历史不复权日K补齐
//      （market 项目同款接口，独立风险池，避开腾讯 fqkline 风控；串行 + 500ms 间隔 +
//        熔断 + 末尾重试；缺口日的既有行可能是早前盘中快照，故全量 enabled 股覆盖式
//        重写为终值，不做"已有行即跳过"优化）
//   ④ 当日快照：qt 批量实时行情，仅写入时间戳=今日的行（防未开盘时昨收错标当日）——
//        盘中 = 当时实时值（收盘后重跑覆盖终值），收盘后 = 当日终值；
//      enabled 联动（停牌停用/复牌启用）仅在收盘后执行，防盘中未开盘股被误停用
//   ⑤ 完整性：收盘且当日有行 → final_through = 今日；否则保持（= 数据完整到的交易日）
//
// 数据口径：不复权（与既有新浪回填一致）；量纲换算——日K 量(手)×100→股，实时额取
//   qt [35] 第 3 段（精确到元），缺失时 [37](万)×1e4。手取整与股级精度差 <100 股/日，可忽略。
import { openDb, nowStr, loadTaskState, saveTaskState } from '../lib/db.mjs'
import { sleep } from '../lib/http.mjs'
import { fetchDayHistory } from '../lib/sina.mjs'
import { fetchMarketPhase, fetchTradingDates, fetchQtQuotes } from '../lib/tencent.mjs'

const TASK_ID = 'sync:kline-daily'
const FILL_GAP_MS = 500 // 补数请求间隔
const CIRCUIT_LIMIT = 10 // 连续失败熔断阈值

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const today = () => nowStr().slice(0, 10)

/** qt 实时字段 → 当日行情行；无行情 / 非今日时间戳 / 停牌未开盘（open≤0 或现价≤0）返回 null 不写。 */
function quoteToRow(code, f, date) {
  if (!f) return null
  if (String(f[30] ?? '').slice(0, 8) !== date.replaceAll('-', '')) return null
  const open = num(f[5])
  const close = num(f[3])
  const high = num(f[33])
  const low = num(f[34])
  if (!(open > 0 && close > 0)) return null
  const volume = num(f[36])
  const amount = num(String(f[35] ?? '').split('/')[2]) ?? (num(f[37]) != null ? num(f[37]) * 1e4 : null)
  return {
    code,
    trade_date: date,
    open,
    high,
    low,
    close,
    volume: volume != null ? Math.round(volume) * 100 : null,
    amount
  }
}

/** 单股缺口行：新浪全历史日K → 仅缺口日行（不复权，量纲=股，无成交额 → amount=null）。 */
async function fetchGapRows(code, exchange, missingSet) {
  const rows = await fetchDayHistory(code, exchange)
  return rows.filter((r) => missingSet.has(r.trade_date)).map((r) => ({ code, ...r, amount: null }))
}

export async function run(args = []) {
  const statusOnly = args.includes('--status')
  const db = openDb()
  for (const t of ['kline_daily', 'stocks']) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t)) {
      console.error(`${t} 表不存在：market.db 快照不完整（本项目不自建表，请自 market 项目重新复制）`)
      process.exit(1)
    }
  }
  const upsert = db.prepare(
    `INSERT INTO kline_daily (code, trade_date, open, high, low, close, volume, amount)
     VALUES (@code, @trade_date, @open, @high, @low, @close, @volume, @amount)
     ON CONFLICT(code, trade_date) DO UPDATE SET
       open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
       volume=excluded.volume, amount=COALESCE(excluded.amount, kline_daily.amount)`
  )

  // ── 状态与库内基线 ──
  const state = loadTaskState()
  const t = today()
  const maxD = db.prepare('SELECT MAX(trade_date) d FROM kline_daily').get().d

  // ── --status：只读报告，不写不请求 ──
  if (statusOnly) {
    const st = state[TASK_ID] ?? {}
    const last = db
      .prepare('SELECT trade_date d, COUNT(*) n FROM kline_daily GROUP BY trade_date ORDER BY d DESC LIMIT 1')
      .get()
    console.log(`kline_daily 数据完整至：${st.final_through ?? '未知（无状态文件，首次同步将自动初始化）'}`)
    console.log(`库内最新交易日：${last?.d ?? '-'}（${last?.n ?? 0} 行）`)
    console.log(`上次同步：${st.last_run_at ?? '-'}（${st.phase ?? '-'} / ${st.last_status ?? '-'}）`)
    db.close()
    return
  }

  // ── ① 市场状态 + ② 交易日历 ──
  console.log('① 市场状态：检查 sh000001 实时行情时间戳…')
  const phase = await fetchMarketPhase(t)
  const phaseText = phase.closed ? '交易日·已收盘' : phase.tradingDay ? '交易日·盘中' : '非交易日/未开盘'
  console.log(`   ${phaseText}`)
  let calendar = await fetchTradingDates(90)
  if (maxD && calendar[0] > maxD) calendar = await fetchTradingDates(640)
  calendar = calendar.filter((d) => d <= t)
  if (maxD && calendar[0] > maxD) {
    console.error(`数据缺口超过 640 个交易日（库内最新 ${maxD}），请自 market 项目重新复制 market.db`)
    process.exit(1)
  }

  // ── final_through 初始化/校准 ──
  // 无状态（首次/换库）：库内最新行即基线；但"最新行=今日且未收盘"时今日为盘中快照，基线退到上一交易日。
  // 注：无状态且最新行=今日已收盘时视作终值（假定快照来自 market 项目收盘后同步）。
  let finalThrough = state[TASK_ID]?.final_through ?? null
  if (finalThrough == null || finalThrough > maxD) {
    finalThrough = maxD === t && !phase.closed ? (calendar.filter((d) => d < t).pop() ?? maxD) : maxD
  }

  // ── 快速通道：今日终值已同步（收盘后重跑安全，秒回） ──
  if (finalThrough >= t && phase.closed) {
    console.log(`② 今日终值已同步（数据完整至 ${finalThrough}），无需更新`)
    db.close()
    return
  }

  // ── ③ 漏跑交易日补数（自动，含"早前只跑过盘中快照"的日期） ──
  const missing = calendar.filter((d) => d > finalThrough && d < t)
  let backfillRows = 0
  let failed = []
  if (missing.length > 0) {
    // 缺口日既有行可能是盘中快照 → 不做"已有行即跳过"优化，全量 enabled 股覆盖式补终值
    const todo = db.prepare('SELECT code, exchange FROM stocks WHERE enabled = 1 ORDER BY code').all()
    console.log(
      `② 漏跑补数：${missing[0]} ~ ${missing[missing.length - 1]} 共 ${missing.length} 个交易日，逐股回填 ${todo.length} 只…`
    )
    const missingSet = new Set(missing)
    let done = 0
    let circuit = 0
    const ts = () => nowStr().slice(0, 19)
    for (const { code, exchange } of todo) {
      if (circuit >= CIRCUIT_LIMIT) {
        console.warn(`   ⚠ 连续 ${CIRCUIT_LIMIT} 次失败，疑似限流，熔断停止（已写数据不动；任意时刻重跑即续传）`)
        break
      }
      try {
        const rows = await fetchGapRows(code, exchange, missingSet)
        if (rows.length > 0) {
          db.exec('BEGIN')
          try {
            for (const r of rows) upsert.run(r)
            db.exec('COMMIT')
          } catch (e) {
            db.exec('ROLLBACK')
            throw e
          }
          backfillRows += rows.length
        }
        done++
        circuit = 0
      } catch (e) {
        failed.push(code)
        circuit++
        console.warn(`   ${code} 失败（${e.message}）连续失败 ${circuit}/${CIRCUIT_LIMIT}`)
      }
      process.stdout.write(`   补数进度 ${done}/${todo.length}（失败 ${failed.length}）· ${ts()}\r`)
      await sleep(FILL_GAP_MS)
    }
    console.log(`   补数进度：完成 ${done} / ${todo.length}，失败 ${failed.length}，写入 ${backfillRows} 行`)
    // 失败隔离：末尾统一重试一轮
    if (failed.length > 0 && circuit < CIRCUIT_LIMIT) {
      console.log(`③ 失败重试：${failed.length} 只`)
      const retryFail = []
      for (const code of failed) {
        const { exchange } = db.prepare('SELECT exchange FROM stocks WHERE code=?').get(code)
        try {
          const rows = await fetchGapRows(code, exchange, missingSet)
          db.exec('BEGIN')
          for (const r of rows) upsert.run(r)
          db.exec('COMMIT')
          backfillRows += rows.length
        } catch {
          retryFail.push(code)
        }
        await sleep(FILL_GAP_MS)
      }
      failed = retryFail
    }
    // 全部成功才推进 final_through（部分成功保持原值，重跑续传；长期停牌股缺口日无行不算失败）
    if (failed.length === 0) finalThrough = missing[missing.length - 1]
  } else {
    console.log(`② 漏跑补数：无缺口（数据完整至 ${finalThrough}）`)
  }

  // ── ④ 当日快照（qt 实时；时间戳非今日的行一律不写，防未开盘时昨收错标当日） ──
  let todayCount = 0
  if (phase.tradingDay) {
    console.log(
      `${missing.length > 0 ? '④' : '③'} 当日快照：qt 批量实时行情（${phase.closed ? '收盘终值' : '盘中实时'}）…`
    )
    const writable = db
      .prepare(
        `SELECT code, exchange FROM stocks WHERE enabled = 1
           OR (enabled = 0 AND board != 'star' AND name NOT LIKE '%ST%')`
      )
      .all()
    const quotes = await fetchQtQuotes(
      writable.map((r) => ({ symbol: `${r.exchange.toLowerCase()}${r.code}`, code: r.code }))
    )
    const rows = writable.map((r) => quoteToRow(r.code, quotes.get(r.code), t)).filter(Boolean)
    db.exec('BEGIN')
    try {
      for (const r of rows) upsert.run(r)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    todayCount = rows.length
    console.log(`   当日快照：${todayCount} 只（${phase.closed ? '终值' : '盘中实时'}，停牌/未开盘跳过）`)

    // enabled 联动：仅收盘后执行（盘中未开盘股无当日行，会被误停用）
    if (phase.closed && todayCount > 0) {
      const ts0 = nowStr()
      const rDis = db
        .prepare(
          `UPDATE stocks SET enabled = 0, updated_at = ?
           WHERE enabled = 1
             AND NOT EXISTS (SELECT 1 FROM kline_daily k WHERE k.code = stocks.code AND k.trade_date = ?)`
        )
        .run(ts0, t)
      const rRe = db
        .prepare(
          `UPDATE stocks SET enabled = 1, updated_at = ?
           WHERE enabled = 0 AND board != 'star' AND name NOT LIKE '%ST%'
             AND EXISTS (SELECT 1 FROM kline_daily k WHERE k.code = stocks.code AND k.trade_date = ?)`
        )
        .run(ts0, t)
      console.log(`   enabled 联动：停牌停用 ${rDis.changes} 只，复牌启用 ${rRe.changes} 只`)
    }
  } else {
    console.log(`${missing.length > 0 ? '④' : '③'} 当日快照：跳过（${phaseText}，无当日实时数据）`)
  }

  // ── ⑤ 完整性落状态 ──
  if (phase.closed && todayCount > 0) finalThrough = t
  state[TASK_ID] = {
    ...(state[TASK_ID] ?? {}),
    last_run_at: nowStr(),
    last_status: failed.length > 0 ? 'partial' : 'ok',
    final_through: finalThrough,
    phase: phase.closed ? 'closed' : phase.tradingDay ? 'intraday' : 'non-trading',
    backfill_days: missing.length,
    today_rows: todayCount
  }
  saveTaskState(state)

  // ── ⑥ 摘要（完整性口径） ──
  const total = db
    .prepare('SELECT COUNT(*) n, COUNT(DISTINCT code) c, MIN(trade_date) lo, MAX(trade_date) hi FROM kline_daily')
    .get()
  console.log('⑤ 摘要：')
  console.log(`   kline_daily 共 ${total.n} 行 · 覆盖 ${total.c} 只 · 范围 ${total.lo} ~ ${total.hi}`)
  if (missing.length > 0)
    console.log(
      `   补数 ${missing.length} 个交易日（${missing[0]} ~ ${missing[missing.length - 1]}）· ${backfillRows} 行`
    )
  if (failed.length)
    console.log(
      `   ⚠ 补数仍失败 ${failed.length} 只：${failed.slice(0, 10).join('、')}${failed.length > 10 ? ' …' : ''}（重跑命令自动补）`
    )
  if (phase.closed && todayCount > 0) {
    console.log(`   ✓ 数据完整至 ${finalThrough}（今日终值已同步）`)
  } else if (phase.tradingDay && todayCount > 0) {
    console.log(`   ◐ 今日为盘中快照（数据完整至 ${finalThrough}）——收盘后重跑 npm run maintain 更新终值`)
  } else if (phase.tradingDay) {
    console.log(`   ○ 今日暂无行情行（未开盘/集合竞价），数据完整至 ${finalThrough}`)
  } else {
    console.log(`   ✓ 数据完整至 ${finalThrough}（今日非交易日）`)
  }
  db.close()
}
