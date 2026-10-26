// 腾讯行情接口脚本侧封装：与 BFF provider/tencent 同上游同解析口径（qt.gtimg.cn GBK / ifzq.gtimg.cn JSON），
// 脚本侧独立实现（不走 BFF 缓存），供 sync 任务使用。
import { fetchJsonRetry, fetchTextRetry, sleep } from './http.mjs'

// fqkline 双域名互备：2026-10-26 实测 web.ifzq.gtimg.cn 被风控（501/验证页），无前缀域名正常——
// 与 market 项目一致优先无前缀域名（其腾讯接口仅用 ifzq.gtimg.cn），web. 保留为互备；
// 风控会间歇漂移，失败即换下一个域名重试（粘性域名见 fetchFqkline）。
const FQKLINE_HOSTS = ['https://ifzq.gtimg.cn', 'https://web.ifzq.gtimg.cn']
const QT_HOST = 'https://qt.gtimg.cn'
const QT_BATCH = 60 // qt.gtimg.cn q= 单请求标的数
const DAY_COUNT_MAX = 640

/** fqkline 通用请求（双域名互备；两域名均失败才抛错，由调用方保证失败不落库）。
 *  上游校验：param 必须恰好 6 段（code,period,start,end,count,fq），多一个空段即 code:1 bad params
 *  （HTTP 仍 200）——故必须显式校验响应码，防止"bad params"被当成 0 行成功。
 *  粘性域名：501 风控漂移期单域名一轮退避重试要 ~50s，记住最近成功域名优先访问，
 *  批量回填时只在首个请求付一次切换成本。 */
let preferredHost = null
async function fetchFqkline(path) {
  const hosts = preferredHost ? [preferredHost, ...FQKLINE_HOSTS.filter((h) => h !== preferredHost)] : FQKLINE_HOSTS
  let lastErr
  for (const host of hosts) {
    try {
      const json = await fetchJsonRetry(host + path)
      if (json?.code === 1) throw new Error(`fqkline ${json.msg ?? 'bad params'}：${path}`)
      preferredHost = host
      return json
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

/** 解析 fqkline data[code] 容器 → 行数组（qfqxxx 键优先，退 xxx 键；不复权请求两者同指 day）。 */
function dayRowsOf(json, symbol) {
  const container = json?.data?.[symbol] ?? {}
  const rows = container.qfqday ?? container.day
  return Array.isArray(rows) ? rows : []
}

/**
 * 市场状态（一次 sh000001 实时行情）：
 *   tradingDay = 今日是否交易日（行情时间戳日期 == 今日；非交易日/未开盘时戳为上一交易时段）
 *   closed     = 交易日且时间戳 ≥ 15:00（当日已收盘，行情为终值）
 * 时间戳字段 [30] 形如 20261026161450（勿当数值用）。
 * @param {string} today YYYY-MM-DD
 */
export async function fetchMarketPhase(today) {
  const text = await fetchTextRetry(`${QT_HOST}/q=sh000001`, { charset: 'gbk' })
  const m = text.match(/sh000001="([^"]+)/)
  const ts = m ? String(m[1].split('~')[30] ?? '') : ''
  const tradingDay = ts.slice(0, 8) === today.replaceAll('-', '')
  return { tradingDay, closed: tradingDay && ts.slice(8, 12) >= '1500' }
}

/** 交易日历（sh000001 日K 日期序列，腾讯权威日历）：升序返回最近 count 个交易日。 */
export async function fetchTradingDates(count) {
  const json = await fetchFqkline(
    `/appstock/app/fqkline/get?param=sh000001,day,,,${Math.min(count, DAY_COUNT_MAX)},qfq`
  )
  return dayRowsOf(json, 'sh000001')
    .map((r) => String(r[0]))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
}

/**
 * 单股不复权日K（fqkline 空 fq → day 键，与库内既有新浪不复权口径一致）。
 * 返回自 from 起全部行（含当日实时 bar），行 [date, open, close, high, low, volume(手)]。
 * 注：腾讯带 end 日期会漏当日 bar，end 一律留空，调用方按日期过滤。
 */
export async function fetchDayBars(code, exchange, from) {
  const symbol = `${exchange.toLowerCase()}${code}`
  const json = await fetchFqkline(`/appstock/app/fqkline/get?param=${symbol},day,${from},,${DAY_COUNT_MAX},`)
  return dayRowsOf(json, symbol)
}

/**
 * 批量实时行情：分批拉 qt.gtimg.cn（GBK），返回 code → 字段数组。
 * 字段序号（与 provider/tencent/parse.ts 口径一致，2026-10-26 实测核对）：
 * [1]名称 [3]现价 [4]昨收 [5]今开 [30]时间戳 [33]最高 [34]最低 [36]成交量(手)
 * [35]"现价/量(手)/额(元)"（第 3 段为精确到元的成交额） [37]成交额(万)
 * @param {{symbol: string, code: string}[]} items
 */
export async function fetchQtQuotes(items) {
  const out = new Map()
  for (let i = 0; i < items.length; i += QT_BATCH) {
    const batch = items.slice(i, i + QT_BATCH)
    const text = await fetchTextRetry(`${QT_HOST}/q=${batch.map((it) => it.symbol).join(',')}`, { charset: 'gbk' })
    for (const m of text.matchAll(/v_(?:sh|sz|bj)(\d{6})="([^"]+)/g)) {
      out.set(m[1], m[2].split('~'))
    }
    process.stdout.write(`  实时行情：${Math.min(i + QT_BATCH, items.length)} / ${items.length}\r`)
    if (i + QT_BATCH < items.length) await sleep(300)
  }
  console.log(`  实时行情：完成 ${out.size} / ${items.length}`)
  return out
}
