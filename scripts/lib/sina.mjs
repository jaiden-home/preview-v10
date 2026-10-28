// 新浪行情接口脚本侧封装：漏跑补数专用单股全历史日K（market 项目同款接口同口径）。
// 与腾讯 qt/ifzq 分属不同风险池——补数不再打腾讯 fqkline（风控高发口，逐股批量请求易触发）；
// 市场状态 / 交易日历 / 当日快照仍走腾讯（tencent.mjs），BFF 上游不变。
// 接口特性：scale=240 日K，datalen=10000 一次拉到上市日（无 640 根上限）；不复权；
//   volume 单位=股（与库内既有新浪回填口径一致，无需 ×100）；无成交额（amount 由调用方置 null）。
import { fetchJsonRetry } from './http.mjs'

const KLINE_URL = 'http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData'
const DATALEN = 10000
const HEADERS = { Referer: 'https://finance.sina.com.cn' } // 新浪接口需带 Referer（market 项目实测口径）

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 单股全历史不复权日K（一次请求到上市日）。
 * 返回升序行 {trade_date, open, high, low, close, volume(股)}，已剔除非法行
 * （日期格式不符 / 开收价 ≤0，即停牌零行）；调用方按缺口日过滤（行带真实日期，幂等）。
 * 失败抛错由调用方保证不落库（http.mjs 退避重试后上抛）。
 * @param {string} code 6 位代码
 * @param {string} exchange SH/SZ/BJ
 */
export async function fetchDayHistory(code, exchange) {
  const symbol = `${exchange.toLowerCase()}${code}`
  const json = await fetchJsonRetry(`${KLINE_URL}?symbol=${symbol}&scale=240&ma=no&datalen=${DATALEN}`, {
    headers: HEADERS
  })
  const arr = Array.isArray(json) ? json : []
  return arr
    .map((k) => ({
      trade_date: String(k.day ?? '').slice(0, 10),
      open: num(k.open),
      high: num(k.high),
      low: num(k.low),
      close: num(k.close),
      volume: num(k.volume)
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.trade_date) && r.open > 0 && r.close > 0)
}
