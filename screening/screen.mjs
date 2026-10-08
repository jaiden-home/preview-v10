// A 股均线多头全池筛选（沪深主板 + 创业板）—— 单脚本：筛选 + 缓存 + HTML 视图
// 条件：最新收盘价 > MA30，且 MA30 > MA60 连续 >= 30 个交易日
// 排除：ST/*ST（名称含 ST）、上市不满 1 年（以行情首日近似上市日）、退市/数据不足
//
// 用法：
//   node screening/screen.mjs                        # 以今天为 asOf 全量筛选，并生成 index.html
//   node screening/screen.mjs --asof=2026-10-06      # 指定基准日
//   node screening/screen.mjs --probe                # 小规模试跑（不写正式缓存、不生成 HTML）
//   node screening/screen.mjs --force                # 同 asof 已有缓存时强制重拉
//
// 缓存策略（累积，不覆盖历史）：
//   - 每个基准日一份 data/{asof}.final.json（权威结果），不同 asof 互不影响；
//   - 同 asof 重跑且缓存已存在时默认直接复用，仅重建 HTML（--force 才重新抓取）；
//   - index.html 为可再生成视图：内嵌全部 final.json 数据，双击即开，
//     支持批次切换、检索排序与跨批次「指标符合天数」对比。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DAY = 86_400_000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// —— 参数解析 ——
const args = process.argv.slice(2)
const argOf = (name) => {
  const a = args.find((s) => s.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : null
}
const ASOF = argOf('asof') ?? new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(ASOF) || Date.parse(ASOF) > Date.now()) {
  console.error(`[fatal] 非法 asof: ${ASOF}（须为今天或之前的 YYYY-MM-DD）`)
  process.exit(1)
}
const PROBE = args.includes('--probe')
const FORCE = args.includes('--force')
// 保守模式（默认）：仅走 proxy 备用端点 + 并发 4 + 300ms 节流，防上游限流；--fast 恢复直连并发 8
const PROXY = !args.includes('--fast')
const OUT_DIR = argOf('out') ?? path.join(HERE, 'data')
fs.mkdirSync(OUT_DIR, { recursive: true })
const suffix = PROBE ? '.probe' : '.final'
const outFile = path.join(OUT_DIR, `${ASOF}${suffix}.json`)

const ASOF_TS = Date.parse(`${ASOF}T00:00:00+08:00`)
const FROM = new Date(ASOF_TS - 500 * DAY).toISOString().slice(0, 10) // 约 340 个交易日

// —— 股票池候选段（沪深主板 + 创业板；科创板/北交所/B 股不在内）——
const SEGMENTS = [
  ['sh', 600000, 600999], // 沪主板 600
  ['sh', 601000, 601999], // 沪主板 601
  ['sh', 603000, 603999], // 沪主板 603
  ['sh', 605000, 605999], // 沪主板 605
  ['sz', 1, 999], // 深主板 000
  ['sz', 1000, 1999], // 深主板 001
  ['sz', 2000, 2999], // 深主板 002（原中小板，已并入主板）
  ['sz', 3000, 3999], // 深主板 003
  ['sz', 300000, 301999], // 创业板 300/301
  ['sz', 302000, 302999] // 创业板 302
]

// 日 K 端点池：前两个为直连域名（易触发 501），后两个为 proxy 备用（限流后自动降级至此）
const ENDPOINTS = [
  'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=',
  'https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=',
  'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get?param=',
  'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?param='
]
let epStart = 0 // 501 后置 2：后续请求直接从 proxy 备用开始
let epSeq = 0
let throttleUntil = 0 // 全局冷却门闩：501 后所有 worker 暂停
const KL_ENDPOINTS = PROXY ? ENDPOINTS.slice(2) : ENDPOINTS

function decodeGbk(buf) {
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return new TextDecoder('gb18030').decode(buf)
  }
}

// —— 批量报价：名称非空 = 有效标的；同时提取盘中口径所需的当前价/当日最高/行情时间戳 ——
async function fetchQuotes(codes) {
  const res = await fetch(`https://qt.gtimg.cn/q=${codes.join(',')}`, { signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`qt http ${res.status}`)
  const text = decodeGbk(await res.arrayBuffer())
  const out = new Map()
  for (const line of text.split(';')) {
    const m = line.match(/v_(s[hz]\d{6})="([^"]*)"/)
    if (!m) continue
    const f = m[2].split('~')
    const name = (f[1] ?? '').trim()
    if (!name) continue
    out.set(m[1], {
      name,
      price: Number.parseFloat(f[3]), // 当前价（盘中 = 未收盘价）
      high: Number.parseFloat(f[33]), // 当日最高
      time: f[30] ?? '' // 行情时间戳 yyyyMMddHHmmss（停牌股为旧日期）
    })
  }
  return out
}

// —— 前复权日 K（近 500 自然日；newfqkline 会返回最近 640 根，口径一致）——
// live：报价快照。K 线接口盘中不含当日未收盘 bar——若报价时间戳落在基准日（说明当日有行情），
// 以报价合成当日 bar（当前价 = 收盘、当日最高 = 最高价），满足"当前价默认成收盘状态"。
async function fetchDaily(code, { throttle = 0, maxRetry = 5, live = null } = {}) {
  const param = `${code},day,${FROM},${ASOF},640,qfq`
  let lastErr = null
  for (let i = 0; i < maxRetry; i++) {
    if (throttle) await sleep(throttle) // 节流（补跑模式）
    const wait = throttleUntil - Date.now()
    if (wait > 0) await sleep(wait) // 全局冷却门闩
    const url = KL_ENDPOINTS[(epStart + epSeq++) % KL_ENDPOINTS.length] + param
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Referer: 'https://gu.qq.com/' } })
      if ([501, 502, 503].includes(res.status)) {
        throttleUntil = Date.now() + Math.min(60_000, 15_000 * (i + 1))
        epStart = 2 // 降级：后续从 proxy 备用域名开始
        lastErr = new Error(`http ${res.status}`)
        continue
      }
      if (!res.ok) throw new Error(`http ${res.status}`)
      const j = await res.json()
      const node = j?.data?.[code]
      const rows = node?.qfqday ?? node?.day
      if (!Array.isArray(rows) || rows.length === 0) return null // 退市/无数据
      const bars = rows
        .map((r) => ({ date: String(r[0]), close: Number.parseFloat(r[2]), high: Number.parseFloat(r[3]) }))
        .filter((b) => Number.isFinite(b.close))
      if (!bars.length) return null
      // 盘中合成当日 bar：报价时间戳日期 == 基准日（当日有行情）且 K 线末端尚无当日 bar
      if (
        live &&
        String(live.time).slice(0, 8) === ASOF.replaceAll('-', '') &&
        Number.isFinite(live.price) &&
        live.price > 0
      ) {
        if (bars[bars.length - 1].date < ASOF) {
          bars.push({
            date: ASOF,
            close: live.price,
            high: Number.isFinite(live.high) && live.high > 0 ? live.high : live.price
          })
        }
      }
      return bars
    } catch (e) {
      lastErr = e
    }
  }
  return 'FAIL'
}

// —— 指标判定：前缀和求 MA，自最新交易日向前递推连续天数 ——
// 命中口径（或关系）：① 最新收盘价 > MA30 且 MA30 > MA60 连续 ≥ 30 日（含当日）；
// ② 最新交易日当日形成 B 点（docs/SIGNAL_RULES.md 第一节形态，不含持仓状态约束）
// B 点形态：三日强涨（每日 high ≥ 前日 high×0.999 且 close > 前日 close）
// + 第 3 日收盘 ≥ MA30 + 动能保护（R2+R3 ≥ 50%×R1 且 R3 ≥ 15%×R2）
function evaluate(bars) {
  const firstTs = Date.parse(`${bars[0].date}T00:00:00+08:00`)
  if (ASOF_TS - firstTs < 365 * DAY) return { stage: 'subnew' } // 上市不满 1 年（近似口径）
  if (bars.length < 31) return { stage: 'insufficient' } // 条件②最小需求：31 根（B 点判定 t ≥ 30 + 前一日）；不足即两条都无法验证
  const n = bars.length
  // 停牌过期：最后 K 线距基准日超过 16 个自然日（≈ 基准日与最后交易日差 ≤6 天 + 10 天容忍）。
  // 排除已退市/吸收合并股票的接口残留老 K 线（如 2011 年停牌至今），保留一周内的临时停牌。
  const staleDays = (ASOF_TS - Date.parse(`${bars[n - 1].date}T00:00:00+08:00`)) / DAY
  if (staleDays > 16) return { stage: 'nodata' }
  const closes = bars.map((b) => b.close)
  const highs = bars.map((b) => b.high)
  const S = [0]
  for (const c of closes) S.push(S[S.length - 1] + c)
  const ma = (t, w) => (S[t + 1] - S[t + 1 - w]) / w
  // 条件①：连续 MA30 > MA60 天数（含最新交易日；不足 89 根记 0——MA60 无法计算）
  let run = 0
  for (let t = n - 1; t >= 59; t--) {
    if (ma(t, 30) > ma(t, 60)) run++
    else break
  }
  const ma30 = ma(n - 1, 30)
  const ma60 = n >= 60 ? ma(n - 1, 60) : ma30 // 不足 60 根时开口比按 1 计（条件①必不成立）
  const lastClose = closes[n - 1]
  const condTrend = n >= 74 && run >= 15 && lastClose > ma30 // 60 + 15 - 1 = 74 根为条件①最小数据量
  // B 点形态判定（对第 t 日，需 t ≥ 30：MA30 可算且窗口前一日存在）
  const isBuyPattern = (t) => {
    if (t < 30) return false
    for (let i = t - 2; i <= t; i++) {
      if (!(highs[i] >= highs[i - 1] * 0.999 && closes[i] > closes[i - 1])) return false
    }
    if (closes[t] < ma(t, 30)) return false
    const R1 = closes[t - 2] / closes[t - 3] - 1
    const R2 = closes[t - 1] / closes[t - 2] - 1
    const R3 = closes[t] / closes[t - 1] - 1
    if (R1 * 0.5 > R2 + R3) return false // BUY_TAIL_REPAIR_MIN
    if (R2 * 0.15 > R3) return false // BUY_FADE_RATIO
    return true
  }
  // 最近买入点：自最新交易日向前最近一次 B 点形态成立的日期（信息字段，不限当日）
  let buyT = -1
  for (let t = n - 1; t >= 30; t--) {
    if (isBuyPattern(t)) {
      buyT = t
      break
    }
  }
  const lastBuyDate = buyT >= 0 ? bars[buyT].date : ''
  // 条件②：最新交易日当日形成 B 点
  const condBuy = buyT === n - 1
  // 连涨天数：最新交易日收涨则向前数连续上涨日数（当日计 1），最新未收涨为 0
  let upStreak = 0
  if (n >= 2 && closes[n - 1] > closes[n - 2]) {
    upStreak = 1
    for (let t = n - 2; t >= 1; t--) {
      if (closes[t] > closes[t - 1]) upStreak++
      else break
    }
  }
  // 快速反转：B 窗口首日收盘仍在 5 日均线下方——自 MA5 之下连涨出 B 点
  const fastReversal = buyT >= 0 && closes[buyT - 2] < ma(buyT - 2, 5)
  return {
    stage: condTrend || condBuy ? 'hit' : 'miss',
    lastClose,
    ma30,
    ma60,
    maRatio: ma30 / ma60, // 均线开口比：>1 为多头开口，越大开口越大
    runDays: run,
    lastBuyDate,
    upStreak,
    fastReversal,
    lastDate: bars[n - 1].date
  }
}

async function pool(items, size, worker) {
  let idx = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (idx < items.length) await worker(items[idx++])
    })
  )
}

// —— 连涨+：跨批次保持计数（data/streak-state.json 持久化）——
// 口径：记录"连涨跨批次仍未中断"发生的次数。首跑（无上批状态）为 0——只有一份数据谈不上保持；
// 之后每次跑数若最新仍连涨且天数较上批不减（未中断）→ 计数 +1；中断或未收涨 → 归 0 并移出状态。
const STREAK_FILE = path.join(OUT_DIR, 'streak-state.json')

function applyStreakRuns(hits) {
  let prev = {}
  try {
    prev = JSON.parse(fs.readFileSync(STREAK_FILE, 'utf8')).items ?? {}
  } catch {
    /* 首次运行无状态 */
  }
  const items = {}
  for (const h of hits) {
    const p = prev[h.code]
    const kept = h.upStreak > 0 && p && p.days > 0 && h.upStreak >= p.days && h.lastDate > p.lastDate
    h.upStreakRuns = kept ? p.runs + 1 : 0
    if (h.upStreak > 0) items[h.code] = { days: h.upStreak, lastDate: h.lastDate, runs: h.upStreakRuns }
  }
  fs.writeFileSync(STREAK_FILE, JSON.stringify({ asOf: ASOF, items }, null, 2))
}

async function screenBatch(list, names, concurrency, throttleMs, stats, hits, progressLabel) {
  const failed = []
  let done = 0
  const t0 = Date.now()
  await pool(list, concurrency, async (e) => {
    const bars = await fetchDaily(e.code, { throttle: throttleMs, live: e.live })
    if (bars === 'FAIL') {
      stats.fail++
      failed.push(e)
    } else if (!bars) {
      stats.nodata++ // 退市/无数据，保守排除
    } else {
      // 批次级最后交易日：所有标的 K 线末端日期的最大值（ISO 字符串可直接比较）
      const last = bars[bars.length - 1].date
      if (last > (stats.lastTradeDate ?? '')) stats.lastTradeDate = last
      const r = evaluate(bars)
      stats[r.stage]++
      if (r.stage === 'hit') {
        hits.push({
          code: e.code,
          name: names.get(e.code),
          lastDate: r.lastDate,
          lastClose: r.lastClose,
          ma30: r.ma30,
          ma60: r.ma60,
          maRatio: r.maRatio,
          runDays: r.runDays,
          lastBuyDate: r.lastBuyDate,
          upStreak: r.upStreak,
          fastReversal: r.fastReversal
        })
      }
    }
    done++
    if (done % 200 === 0) {
      const rate = (done / ((Date.now() - t0) / 1000)).toFixed(1)
      console.log(`[${progressLabel}] ${done}/${list.length} (${rate}/s)`, JSON.stringify(stats))
    }
  })
  return failed
}

async function runScreening() {
  console.log(`[screen] asof=${ASOF} window=${FROM}~${ASOF} out=${outFile}`)

  // 1) 枚举候选代码段
  const candidates = []
  for (const [mkt, from, to] of SEGMENTS)
    for (let i = from; i <= to; i++) candidates.push(mkt + String(i).padStart(6, '0'))

  // 2) 批量报价探测有效标的（probe 只取前 3 批）
  const batches = []
  for (let i = 0; i < candidates.length; i += 80) batches.push(candidates.slice(i, i + 80))
  const quoteBatches = PROBE ? batches.slice(0, 3) : batches
  const valid = new Map()
  let qDone = 0
  await pool(quoteBatches, 5, async (batch) => {
    for (let a = 0; a < 3; a++) {
      try {
        const m = await fetchQuotes(batch)
        for (const [k, v] of m) valid.set(k, v)
        break
      } catch {
        await sleep(500)
      }
    }
    if (++qDone % 20 === 0) console.log(`[quotes] ${qDone}/${quoteBatches.length} batches, valid=${valid.size}`)
  })
  const names = new Map([...valid].map(([k, v]) => [k, v.name]))
  const entries = [...valid.keys()]
    .map((code) => ({ code, live: valid.get(code) }))
    .sort((a, b) => a.code.localeCompare(b.code))
  console.log(`[universe] candidates=${candidates.length} valid=${entries.length}`)

  // 3) ST 过滤
  const nonSt = entries.filter((e) => !names.get(e.code).includes('ST'))
  const stCount = entries.length - nonSt.length
  console.log(`[filter] ST/*ST excluded=${stCount}, remaining=${nonSt.length}`)
  const list = PROBE ? nonSt.slice(0, 5) : nonSt

  // 4) 主跑：拉日 K + 判定（默认保守模式：仅 proxy 端点 + 并发 4 + 300ms 节流；--fast 直连并发 8）
  const stats = { hit: 0, miss: 0, subnew: 0, insufficient: 0, nodata: 0, fail: 0 }
  const hits = []
  let failed = await screenBatch(list, names, PROXY ? 4 : 8, PROXY ? 300 : 0, stats, hits, 'kline')

  // 5) 自动补跑：失败清单低速重拉（并发 2 + 300ms 节流，直连 proxy）
  if (failed.length > 0) {
    console.log(`[retry] ${failed.length} failed -> low-speed rerun via proxy endpoints`)
    epStart = 2
    throttleUntil = Date.now() + 30_000 // 先冷却半分钟
    failed = await screenBatch(failed, names, 2, 300, stats, hits, 'retry')
  }

  hits.sort((a, b) => b.runDays - a.runDays || a.code.localeCompare(b.code))
  applyStreakRuns(hits) // 连涨+：跨批次保持计数（读/写 streak-state.json）
  const out = {
    generatedAt: new Date().toISOString(),
    window: { from: FROM, asOf: ASOF },
    criteria: {
      priceAbove: 'MA30',
      holdAbove: 'MA60',
      minHoldDays: 15,
      orBuySignal: 'latest-trade-day B-point (docs/SIGNAL_RULES.md §一, pattern-only)',
      adjust: 'qfq'
    },
    stats: {
      candidates: candidates.length,
      valid: entries.length,
      stExcluded: stCount,
      evaluated: list.length,
      ...stats,
      stillFailed: failed.map((e) => e.code)
    },
    hits
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2))
  console.log('[done]', JSON.stringify({ ...out.stats, stillFailed: out.stats.stillFailed.length }))
  console.log(`[hits] ${hits.length} -> ${outFile}`)
  if (out.stats.stillFailed.length > 0) {
    console.log(`[warn] ${out.stats.stillFailed.length} 只仍失败（见 stats.stillFailed），可稍后 --force 重跑补齐`)
  }
}

// —— 概念数据（腾讯 plateNew 个股板块接口，与板块行情 getRank 同体系）——
// 统一源说明：个股概念（plateNew，概念 id 如 02003800）与板块行情列表（getRank，code=pt+id）
// 为同一编码体系，个股概念名必然存在于板块行情列表中（完全匹配），支持热力图点击筛选。
// 结果持久化到 concepts.cache.json 跨批次复用——同一只股票的概念只抓一次。
// 防封策略：串行请求、间隔 700ms+随机抖动、指数退避重试、连续失败 5 次即中止（断点续存）。
const CONCEPT_CACHE_FILE = path.join(OUT_DIR, 'concepts.cache.json')
const CONCEPT_HEADERS = { Referer: 'https://gu.qq.com/' }

async function fetchConcepts(code) {
  const url = `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/stockinfo/plateNew?code=${code}&app=wzq&zdf=1`
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: CONCEPT_HEADERS, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`http ${res.status}`)
      const j = await res.json()
      const list = j?.data?.concept
      if (!Array.isArray(list)) return [] // 接口正常但无概念：缓存空数组，避免反复拉取
      return list.map((c) => c.name).filter(Boolean)
    } catch {
      await sleep(2000 * (i + 1)) // 指数退避后重试
    }
  }
  return null // 失败
}

async function enrichConcepts(hits) {
  // 概念数据唯一来源：本脚本自建缓存 concepts.cache.json（逐股 plateNew 抓取的持久结果）
  let cache = { fetchedAt: new Date().toISOString(), map: {} }
  try {
    cache = JSON.parse(fs.readFileSync(CONCEPT_CACHE_FILE, 'utf8'))
  } catch {
    /* 首次运行无缓存 */
  }
  const todo = []
  for (const h of hits) {
    if (Array.isArray(h.concepts)) continue
    if (Array.isArray(cache.map[h.code])) h.concepts = cache.map[h.code]
    else todo.push(h)
  }
  if (todo.length === 0) {
    console.log(`[concepts] ${hits.length} 只概念全部命中缓存（${path.basename(CONCEPT_CACHE_FILE)}），0 次请求`)
    return
  }
  // plateNew 逐股低速抓取（串行 + 节流 + 退避 + 断点续存）
  console.log(`[concepts] 需抓取 ${todo.length} 只（其余命中缓存），串行低速约 ${Math.ceil(todo.length / 60)} 分钟`)
  let done = 0
  let fails = 0
  for (const h of todo) {
    if (fails >= 5) {
      console.warn('[concepts] 连续失败 5 次，疑似触发风控，中止抓取（已完成部分已入缓存，稍后重跑本命令续抓）')
      break
    }
    const list = await fetchConcepts(h.code)
    if (list === null) {
      fails++
      continue
    }
    fails = 0
    cache.map[h.code] = list
    if (++done % 20 === 0) {
      fs.writeFileSync(CONCEPT_CACHE_FILE, JSON.stringify(cache))
      console.log(`[concepts] ${done}/${todo.length}`)
    }
    await sleep(700 + Math.random() * 300) // 节流：约 1 只/秒 + 抖动
  }
  cache.fetchedAt = new Date().toISOString()
  fs.writeFileSync(CONCEPT_CACHE_FILE, JSON.stringify(cache))
  // 只回填缓存中已有的（含确认无概念的空数组）；抓取失败的保持缺字段，下次运行续抓
  for (const h of hits) {
    const c = cache.map[h.code]
    if (!Array.isArray(h.concepts) && Array.isArray(c)) h.concepts = c
  }
  console.log(`[concepts] 完成 ${done}/${todo.length}，缓存已更新`)
}

// —— 概念板块行情热力（腾讯同源 getRank；与本地命中无关，市场维度快照）——
// 防封：全量约 800 个板块仅 4 次分页请求（200/页，串行 + 1s 间隔 + 失败退避），当日缓存 0 请求。
const BOARD_CACHE_FILE = path.join(OUT_DIR, 'board-heat.cache.json')

async function fetchBoardHeat() {
  try {
    const c = JSON.parse(fs.readFileSync(BOARD_CACHE_FILE, 'utf8'))
    if (c.date === ASOF && Array.isArray(c.boards) && c.boards.length > 0) {
      console.log(`[boards] 当日缓存命中（${c.boards.length} 个板块，fetchedAt ${c.fetchedAt}），0 请求`)
      return c.boards
    }
  } catch {
    /* 无缓存 */
  }
  const raw = []
  for (let offset = 0; offset < 1200; offset += 200) {
    const url =
      'https://proxy.finance.qq.com/cgi/cgi-bin/rank/pt/getRank?board_type=gn&sort_type=price&direct=down' +
      `&offset=${offset}&count=200`
    let list = null
    for (let a = 0; a < 3 && !list; a++) {
      try {
        const res = await fetch(url, {
          headers: { Referer: 'https://gu.qq.com/' },
          signal: AbortSignal.timeout(12_000)
        })
        const j = await res.json()
        if (j?.code === 0 && Array.isArray(j.data?.rank_list)) list = j.data.rank_list
      } catch {
        /* 重试 */
      }
      if (!list) await sleep(1500 * (a + 1))
    }
    if (!list || list.length === 0) break
    raw.push(...list)
    if (list.length < 200) break
    await sleep(1000) // 分页节流
  }
  if (raw.length === 0) return []
  // 缓存接口返回的全部原始字段（含资金/换手/多周期涨幅等），热度驱动口径可随时切换
  const boards = raw.filter((b) => b && b.name)
  const out = { fetchedAt: new Date().toISOString(), date: ASOF, boards }
  fs.writeFileSync(BOARD_CACHE_FILE, JSON.stringify(out, null, 2))
  console.log(`[boards] 腾讯概念板块 ${boards.length} 个（全字段） -> ${path.basename(BOARD_CACHE_FILE)}`)
  return boards
}

// —— HTML 视图（自包含：内嵌全部批次数据，双击即开）——
function collectBatches(dataDir) {
  return fs
    .readdirSync(dataDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.final\.json$/.test(f))
    .sort()
    .map((f) => {
      const j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'))
      // 兼容旧缓存（无 lastTradeDate 字段）：从命中清单的 lastDate 推断
      const lastTradeDate = j.stats.lastTradeDate ?? j.hits.reduce((m, h) => (h.lastDate > m ? h.lastDate : m), '')
      return {
        asof: j.window.asOf ?? j.window.to,
        lastTradeDate,
        generatedAt: j.generatedAt,
        stats: j.stats,
        hits: j.hits
      }
    })
}

function buildIndexHtml(batches, boards) {
  const payload = JSON.stringify(batches).replace(/</g, '\\u003c')
  const boardPayload = JSON.stringify(boards).replace(/</g, '\\u003c')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A 股均线多头筛选 · 批次视图</title>
<style>
:root{
  --bg:#f5f6f8;--card:#ffffff;--text:#1c1f23;--muted:#6b7280;--line:#e5e7eb;
  --up:#d92b2b;--down:#0a8f4e;--accent:#2456d6;--chip:#eef1f6;--on-accent:#ffffff;
}
@media (prefers-color-scheme:dark){
  :root{--bg:#101318;--card:#181c23;--text:#e6e9ee;--muted:#98a1ad;--line:#2a3038;
    --up:#f0554f;--down:#35b478;--accent:#6f97f2;--chip:#20252e;--on-accent:#0d1526;}
}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg);color:var(--text);
  font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}
h1{font-size:20px;margin:0 0 4px}
.sub{color:var(--muted);font-size:12px;margin-bottom:16px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;
  padding:16px;margin-bottom:16px;}
h2{font-size:15px;margin:0 0 12px}
.num{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-variant-numeric:tabular-nums;}
.up{color:var(--up)}.down{color:var(--down)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.card{background:var(--bg);border-radius:8px;padding:10px 12px}
.card .k{font-size:12px;color:var(--muted)}
.card .v{font-size:20px;font-weight:600}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.tri{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:5px 12px;font-size:13px;cursor:pointer;transition:color .2s ease,border-color .2s ease}
.tri:hover{color:var(--accent);border-color:var(--accent)}
.tri.on{color:var(--accent);border-color:var(--accent)}
input,select{background:var(--bg);color:var(--text);border:1px solid var(--line);
  border-radius:6px;padding:6px 10px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th{color:var(--muted);font-weight:500}
.sortable{cursor:pointer}
.sortable:hover{color:var(--accent)}
th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}
tbody tr:hover{background:var(--bg)}
.tag{display:inline-block;padding:1px 8px;border-radius:4px;font-size:12px;background:var(--chip);
  margin:0 4px 2px 0}
#boardCloud{position:relative;height:640px;border-radius:8px;overflow:hidden;background:var(--bg)}
.tm{position:absolute;box-sizing:border-box;border:1px solid var(--card);overflow:hidden;
  display:flex;flex-direction:column;justify-content:center;align-items:center;
  cursor:pointer;padding:2px;text-align:center}
.tm .n{font-size:12px;font-weight:500;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tm .v{font-size:11px;font-variant-numeric:tabular-nums}
.tm:hover{filter:brightness(1.08)}
.tm.sel{outline:2px solid var(--accent);outline-offset:-2px;z-index:1}
button{background:var(--bg);color:var(--text);border:1px solid var(--line);
  border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer}
h3{font-size:13px;margin:14px 0 8px;color:var(--muted)}
footer{color:var(--muted);font-size:12px;line-height:1.8}
a{color:var(--accent);text-decoration:none}
</style>
</head>
<body>
<h1>A 股均线多头筛选 · 批次视图</h1>
<div class="sub" id="meta"></div>
<section id="overview"><h2>批次概览</h2><div id="ovCards"></div></section>
<section id="boardSec">
  <h2>概念板块热力 · 市场行情（点击筛选）</h2>
  <div class="toolbar">
    <span class="sub" id="boardState">未选择概念</span>
    <button id="boardClear" type="button">清除筛选</button>
  </div>
  <div id="boardCloud"></div>
  <div class="sub" id="boardNote"></div>
</section>
<section id="tableSec">
  <h2 id="tblTitle">筛选结果</h2>
  <div class="toolbar">
    <input id="q" type="search" placeholder="搜索代码 / 名称" style="width:220px">
    <label class="sub">连涨天数 ≥
      <select id="fStreak" style="width:88px">
        <option value="">不限</option>
        <option value="1">≥ 1 天</option>
        <option value="2">≥ 2 天</option>
        <option value="3">≥ 3 天</option>
        <option value="4">≥ 4 天</option>
        <option value="5">≥ 5 天</option>
        <option value="6">≥ 6 天</option>
        <option value="7">≥ 7 天</option>
        <option value="8">≥ 8 天</option>
        <option value="9">≥ 9 天</option>
      </select>
    </label>
    <button id="fRev" class="tri" title="点击切换：全部 → 是 → 否（含无买入点）→ 全部">快速反转：全部</button>
    <span class="sub" id="rowCount"></span>
  </div>
  <table id="tbl">
    <thead><tr>
      <th>序号</th>
      <th>代码</th><th>名称</th>
      <th>均线开口比</th>
      <th>符合天数</th><th id="thStreak" class="sortable" title="点击按连涨天数排序">连涨天数</th><th>连涨+</th><th id="thRev" class="sortable" title="点击按快速反转排序">快速反转</th>
      <th id="thBuy" class="sortable" title="点击按最近买入点日期排序">最近买入点</th><th>最新交易日</th>
    </tr></thead>
    <tbody></tbody>
  </table>
</section>
<footer>
  口径：沪深主板 + 创业板；排除 ST/*ST、上市不满 1 年（近似）、退市/无行情（日 K 为空）、长期停牌（非次新但 K 线 &lt; 31 根，两条条件都无法验证）标的。
  命中条件（或关系）：① 最新收盘价 &gt; MA30 且 MA30 &gt; MA60 连续 ≥ 15 个交易日（前复权算术均线，含当日）；或 ② 最新交易日当日形成 B 点（docs/SIGNAL_RULES.md 第一节形态口径，不含持仓状态约束）。
  字段：连涨天数 = 最新交易日收涨时向前连续上涨的交易日数（未收涨为 0）；连涨+ = 连涨跨批次未中断的保持计数（streak-state.json 持久化：首跑为 0，之后每次跑数仍连涨且天数不减则 +1，中断归 0）；快速反转 = B 点窗口首日收盘仍在 5 日均线下方（自 MA5 之下连涨出 B 点）；最近买入点 = 最近一次 B 点形态成立日（不限当日）。
  数据来源：腾讯行情接口（与本项目 BFF 同源）；本页由 screening/screen.mjs 自动生成，数据内嵌、离线可用。
</footer>
<script id="payload" type="application/json">${payload}</script>
<script id="board-data" type="application/json">${boardPayload}</script>
<script>
const BATCHES = JSON.parse(document.getElementById('payload').textContent);
const $ = (id) => document.getElementById(id);
const fmt3 = (x) => x == null ? '—' : x.toFixed(3);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const segName = (c) => c.startsWith('sh') ? '沪主板' : (c.startsWith('sz30') ? '创业板' : '深主板');
let cur = BATCHES.length - 1; // 页面固定展示最新批次

// —— 顶部信息 ——
// 批次切换 UI（chips）暂未实现：页面固定展示最新批次（cur = 末位），
// BATCHES 内嵌全部批次数据，未来扩展按索引切换 cur 即可。
function renderMeta() {
  const b = BATCHES[cur];
  const st = b.stats;
  const evaluated = st.hit + st.miss + st.subnew + st.insufficient;
  $('meta').textContent =
    '共 ' + BATCHES.length + ' 个批次 · 基准日 ' + b.asof + ' · 最后交易日 ' + b.lastTradeDate +
    '（生成于 ' + b.generatedAt.slice(0, 10) +
    '）· 命中 ' + st.hit + ' / 可评估 ' + evaluated +
    ' · 数据源：腾讯行情（前复权），由 screening/screen.mjs 生成';
}

// —— 概览卡：分「筛选结果」与「排除条件」两组 ——
function renderOverview() {
  const st = BATCHES[cur].stats;
  const evaluated = st.hit + st.miss + st.subnew + st.insufficient;
  const pct = evaluated ? (st.hit / evaluated * 100).toFixed(1) + '%' : '—';
  // 排除条件四类：ST/*ST（名称含 ST）；次新（行情首日距基准日 < 365 天，近似上市日）；
  // 退市/无行情（日 K 为空，多为已退市残留代码）；长期停牌（非次新但 K 线 < 89 根 = 60+30-1，条件二无法验证）
  const deck = (items) =>
    '<div class="cards">' +
    items
      .map(([k, v]) => '<div class="card"><div class="k">' + k + '</div><div class="v num">' + v + '</div></div>')
      .join('') +
    '</div>';
  $('ovCards').innerHTML =
    '<h3>结果统计</h3>' +
    deck([
      ['命中', st.hit],
      ['可评估', evaluated],
      ['命中率', pct],
    ]) +
    '<h3>排除条件（均不参与技术判定）</h3>' +
    deck([
      ['ST/*ST 风险警示', st.stExcluded],
      ['次新 · 上市不满 1 年', st.subnew],
      ['退市/无行情', st.nodata],
      ['长期停牌 · K线不足', st.insufficient],
    ]);
}

// —— 概念板块热力：腾讯概念板块当日行情（涨跌幅驱动，红涨绿跌）——
// 统一体系：个股概念（plateNew）与板块行情（getRank）为同一腾讯体系，
// 点击热力 chip 即按该概念过滤结果表（与表格概念列精确匹配）。
const BOARDS = (() => {
  try {
    return JSON.parse(document.getElementById('board-data').textContent);
  } catch {
    return [];
  }
})();
let conceptFilter = new Set(); // 当前选中的概念（板块）名集合，多选；空集 = 未过滤（并集口径：命中任一选中概念即通过）

// —— Squarified treemap（Bruls et al.）：把带权重的板块铺满矩形，尽量接近正方形 ——
function squarify(items, x, y, w, h, out) {
  let list = items.slice();
  let X = x;
  let Y = y;
  let W = w;
  let H = h;
  while (list.length > 0 && W > 0.5 && H > 0.5) {
    const total = list.reduce((s, i) => s + i.value, 0);
    if (total <= 0) break;
    const horizontal = W >= H; // 横长矩形切竖条，条内块沿高度堆叠
    const side = horizontal ? H : W; // 条内可用长度
    const depthTotal = horizontal ? W : H; // 切割方向总长
    const worstRatio = (r, sum) => {
      const depth = depthTotal * (sum / total);
      let worst = 0;
      for (const it of r) {
        const len = side * (it.value / sum);
        worst = Math.max(worst, Math.max(len / depth, depth / len));
      }
      return worst;
    };
    let row = [];
    let rowSum = 0;
    while (list.length > 0) {
      const next = list[0];
      const newSum = rowSum + next.value;
      const tryRow = row.concat(next);
      if (row.length === 0 || worstRatio(tryRow, newSum) <= worstRatio(row, rowSum)) {
        row = tryRow;
        rowSum = newSum;
        list.shift();
      } else break;
    }
    const depth = depthTotal * (rowSum / total);
    let off = 0;
    for (const it of row) {
      const len = side * (it.value / rowSum);
      if (horizontal) {
        out.push({ ...it, x: X, y: Y + off, w: depth, h: len });
        off += len;
      } else {
        out.push({ ...it, x: X + off, y: Y, w: len, h: depth });
        off += len;
      }
    }
    if (horizontal) {
      X += depth;
      W -= depth;
    } else {
      Y += depth;
      H -= depth;
    }
  }
  return out;
}

function renderBoardHeat() {
  // 全量显示，但仅保留命中股覆盖的标准概念板块：
  // 1) 排除动态统计板块（BK-GN-FG，如"昨日涨停"）；2) 排除 309 只命中股均未覆盖的概念
  const hitConcepts = new Set();
  for (const h of BATCHES[cur].hits) {
    for (const c of Array.isArray(h.concepts) ? h.concepts : []) hitConcepts.add(c);
  }
  // 热力图口径：面积 = 板块当日涨跌幅（zdf 取绝对值，波动越大块越大）；
  // 颜色 = 涨股比 zgb（上涨家数/总家数：>50% 偏红、<50% 偏绿，越极端颜色越深）
  const parseZgb = (s) => {
    // 注意：本函数内嵌于模板字符串，正则需双反斜杠转义（生成后为 /^(\d+)\/(\d+)$/）
    const m = /^(\\d+)\\/(\\d+)$/.exec(String(s ?? ''));
    if (!m || Number(m[2]) === 0) return null; // 缺失/非法 → 中性色
    return Number(m[1]) / Number(m[2]);
  };
  const items = BOARDS.filter((x) => (x.stock_type ?? '') === 'BK-GN' && hitConcepts.has(x.name))
    .map((x) => ({
      name: x.name,
      zdf: Number.parseFloat(x.zdf),
      ratio: parseZgb(x.zgb),
      zgb: x.zgb ?? '',
      lzg: x.lzg?.name ?? '',
      value: Math.max(Number.parseFloat(x.zdf), 0) || 0.02 // 面积 = 涨幅：涨得越多块越大；下跌/平盘给最小保底面积
    }))
    .filter((x) => Number.isFinite(x.zdf) && Number.isFinite(x.value))
    .sort((a, b) => b.value - a.value); // squarify 要求按权重降序
  const W = 1000; // 虚拟画布宽度，高度按面积比换算，块坐标以百分比输出自适应容器宽度
  const H = 640;
  const cells = squarify(items, 0, 0, W, H, []);
  const cellHtml = cells
    .map((c) => {
      // 颜色编码涨股比：偏离 50% 的程度决定深浅（strength 0~1），方向红/绿
      let bg = 'var(--chip)';
      let fg = 'var(--text)';
      if (c.ratio !== null) {
        const strength = Math.abs(c.ratio - 0.5) / 0.5; // 0（均衡）~ 1（一边倒）
        const pct = strength * 85 + 8; // 混色比例 8%~93%
        const dir = c.ratio > 0.5 ? 'var(--up)' : c.ratio < 0.5 ? 'var(--down)' : 'transparent';
        if (dir !== 'transparent') {
          bg = 'color-mix(in srgb,' + dir + ' ' + pct.toFixed(0) + '%,var(--bg))';
          if (pct >= 50) fg = 'var(--on-accent)';
        }
      }
      const showText = c.w >= 44 && c.h >= 26;
      return (
        '<div class="tm' +
        (conceptFilter.has(c.name) ? ' sel' : '') +
        '" data-n="' +
        esc(c.name) +
        '" title="' +
        esc(c.name) +
        ' ' +
        (c.zdf > 0 ? '+' : '') +
        c.zdf.toFixed(2) +
        '% · 涨股比 ' +
        esc(String(c.zgb)) +
        (c.lzg ? ' · 领涨 ' + c.lzg : '') +
        '" style="left:' +
        (c.x / W) * 100 +
        '%;top:' +
        (c.y / H) * 100 +
        '%;width:' +
        (c.w / W) * 100 +
        '%;height:' +
        (c.h / H) * 100 +
        '%;background:' +
        bg +
        ';color:' +
        fg +
        '">' +
        (showText
          ? '<span class="n">' + esc(c.name) + '</span><span class="v">' +
            (c.zdf > 0 ? '+' : '') + c.zdf.toFixed(2) + '%</span>'
          : '') +
        '</div>'
      );
    })
    .join('');
  $('boardCloud').innerHTML = cellHtml;
  [...$('boardCloud').querySelectorAll('.tm')].forEach((el) =>
    el.addEventListener('click', () => {
      const n = el.dataset.n;
      if (conceptFilter.has(n)) conceptFilter.delete(n); // 再次点击取消（多选 toggle）
      else conceptFilter.add(n);
      renderBoardHeat();
      renderTable();
    })
  );
  const b = BATCHES[cur];
  const n = conceptFilter.size
    ? b.hits.filter((h) => (Array.isArray(h.concepts) ? h.concepts : []).some((c) => conceptFilter.has(c))).length
    : 0;
  $('boardState').textContent = conceptFilter.size
    ? '已选 ' +
      conceptFilter.size +
      ' 个概念（并集）：' +
      [...conceptFilter].join('、') +
      '（命中 ' +
      n +
      ' / ' +
      b.hits.length +
      ' 只，表格已过滤）'
    : '未选择概念';
  $('boardNote').textContent = BOARDS.length
    ? '热力图口径：矩形面积 = 板块当日涨幅（涨得越多块越大，下跌/平盘板块为最小块），颜色 = 涨股比 zgb（上涨家数/成分总家数：>50% 偏红、<50% 偏绿，越接近一边倒颜色越深，悬浮显示详情）。显示 ' +
      items.length +
      ' 个 = 命中股覆盖的标准概念板块全量（已排除动态统计板块与命中股未覆盖的板块，板块行情缓存全量 ' +
      BOARDS.length +
      ' 个）。个股概念与板块行情同属腾讯体系（plateNew / getRank），点击色块可多选概念（并集过滤下方表格），再次点击取消，"清除筛选"清空。'
    : '板块行情数据未获取（可运行 node screening/screen.mjs 拉取）。';
}

// —— 结果表（搜索过滤 + 可排序列；默认按符合天数降序）——
// sortState：null = 默认（符合天数降序）；{ key, dir } = 按列排序，同一时刻仅一列生效
let sortState = null;
let revFilter = 'all'; // 快速反转三态筛选：'all' | 'yes' | 'no'（no 含无买入点）
const SORT_COLS = {
  streak: { title: '连涨天数', base: (h) => h.upStreak ?? 0 }, // 数值降序基准
  rev: { title: '快速反转', base: (h) => (h.lastBuyDate ? (h.fastReversal ? 2 : 1) : 0) }, // 是 > 否 > 无 B 点
  buy: { title: '最近买入点', base: (h) => (h.lastBuyDate ?? '').padEnd(10, '~') } // ISO 日期可直接比较；空值垫底
};
const SORT_IDS = { streak: 'thStreak', rev: 'thRev', buy: 'thBuy' };

function renderTable() {
  const b = BATCHES[cur];
  const kw = $('q').value.trim().toLowerCase();
  const streakMin = Number.parseInt($('fStreak').value, 10); // 连涨天数下限（空/非法 = 不限）
  // 多条件叠加过滤：搜索（代码/名称）AND 连涨天数下限 AND 快速反转三态 AND 热力图概念多选（并集）
  let rows = b.hits.filter(
    (h) =>
      (!kw || h.code.includes(kw) || (h.name || '').toLowerCase().includes(kw)) &&
      (!Number.isFinite(streakMin) || (h.upStreak ?? 0) >= streakMin) &&
      (revFilter === 'all' || (revFilter === 'yes' ? !!(h.lastBuyDate && h.fastReversal) : !(h.lastBuyDate && h.fastReversal))) &&
      (!conceptFilter.size || (Array.isArray(h.concepts) ? h.concepts : []).some((c) => conceptFilter.has(c)))
  );
  const sortNote = sortState
    ? '，按' + SORT_COLS[sortState.key].title + (sortState.dir === 'desc' ? '降序' : '升序')
    : '，按符合天数降序';
  if (sortState) {
    const col = SORT_COLS[sortState.key];
    const sign = sortState.dir === 'desc' ? -1 : 1;
    rows = rows.slice().sort((a, c) => sign * (col.base(a) < col.base(c) ? -1 : col.base(a) > col.base(c) ? 1 : 0));
  }
  const filteredNote = conceptFilter.size ? '，概念过滤（并集 ' + conceptFilter.size + ' 个）' : '';
  $('tblTitle').textContent =
    '筛选结果 · 最后交易日 ' + b.lastTradeDate + '（' + rows.length + ' / ' + b.hits.length + ' 只' + sortNote + filteredNote + '）';
  for (const key of Object.keys(SORT_IDS)) {
    const el = $(SORT_IDS[key]);
    const arrow = sortState && sortState.key === key ? (sortState.dir === 'desc' ? ' ↓' : ' ↑') : '';
    el.textContent = SORT_COLS[key].title + arrow;
  }
  $('tbl').querySelector('tbody').innerHTML = rows
    .map((h, i) => {
      // 概念与收盘价数据保留在 hits，但表格不显示这两列；MA30/MA60 以比值列呈现
      return (
        '<tr><td class="num">' +
        (i + 1) +
        '</td><td class="num">' +
        h.code +
        '</td><td>' +
        esc(h.name) +
        ' <span class="tag">' +
        segName(h.code) +
        '</span></td>' +
        '<td class="num">' +
        fmt3(h.maRatio) +
        '</td><td class="num">' +
        h.runDays +
        '</td><td class="num">' +
        h.upStreak +
        '</td><td class="num">' +
        (h.upStreakRuns ?? 0) +
        '</td><td>' +
        (h.lastBuyDate ? (h.fastReversal ? '是' : '否') : '—') +
        '</td><td class="num">' +
        (h.lastBuyDate || '—') +
        '</td><td class="num">' +
        h.lastDate +
        '</td></tr>'
      );
    })
    .join('');
  $('rowCount').textContent = rows.length + ' / ' + b.hits.length + ' 只';
}
for (const key of Object.keys(SORT_IDS)) {
  $(SORT_IDS[key]).addEventListener('click', () => {
    // 同列循环 默认→降→升→默认；切到新列从降序开始
    sortState =
      sortState && sortState.key === key
        ? sortState.dir === 'desc'
          ? { key, dir: 'asc' }
          : null
        : { key, dir: 'desc' };
    renderTable();
  });
}
$('q').addEventListener('input', renderTable);
$('fStreak').addEventListener('change', renderTable);
$('fRev').addEventListener('click', () => {
  revFilter = revFilter === 'all' ? 'yes' : revFilter === 'yes' ? 'no' : 'all'; // 全部 → 是 → 否 → 全部
  const el = $('fRev');
  el.textContent = '快速反转：' + (revFilter === 'all' ? '全部' : revFilter === 'yes' ? '是' : '否');
  el.classList.toggle('on', revFilter !== 'all');
  renderTable();
});
$('boardClear').addEventListener('click', () => {
  conceptFilter.clear();
  renderBoardHeat();
  renderTable();
});

// —— 批次对比 UI 暂未实现：数据层已就绪 ——
// data/{asof}.final.json 的 hits 含 code/name/lastDate/lastClose/ma30/ma60/runDays，
// 跨批次按 code 关联即可计算 Δ 天数 / 新增 / 掉出，未来扩展直接消费 BATCHES 数组。

function renderAll() {
  renderMeta();
  renderOverview();
  renderBoardHeat();
  renderTable();
}
renderAll();
</script>
</body>
</html>
`
}

async function buildView() {
  const batches = collectBatches(OUT_DIR)
  if (batches.length === 0) return
  const boards = await fetchBoardHeat()
  const htmlFile = path.join(HERE, 'index.html')
  fs.writeFileSync(htmlFile, buildIndexHtml(batches, boards))
  console.log(`[view] ${batches.length} batch(es) + ${boards.length} boards -> ${htmlFile}（双击打开，离线可用）`)
}

async function main() {
  // 缓存复用：同 asof 已有 final.json 时默认跳过抓取（--force 强制重拉）
  if (!PROBE && !FORCE && fs.existsSync(outFile)) {
    console.log(`[cache] ${outFile} 已存在，跳过抓取直接复用（--force 可强制重跑）`)
  } else {
    await runScreening()
  }
  if (!PROBE) {
    // 概念补齐：hits 缺 concepts 字段时才触发网络请求（有 concepts.cache.json 缓存则 0 请求）
    const j = JSON.parse(fs.readFileSync(outFile, 'utf8'))
    if (j.hits.some((h) => !Array.isArray(h.concepts))) {
      await enrichConcepts(j.hits)
      fs.writeFileSync(outFile, JSON.stringify(j, null, 2))
    }
    buildView()
  }
}

main().catch((e) => {
  console.error('[fatal]', e)
  process.exit(1)
})
