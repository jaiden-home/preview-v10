// 公开接口 HTTP 客户端：统一 UA + 退避重试（5s/15s/30s），防止被上游限流（移植自 market 项目）。
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/**
 * GET JSON，失败退避重试。重试仍失败则抛错（调用方保证：失败不落库）。
 * 响应体含 success:false 时同样视为失败（触发重试）。
 * @param {string} url
 * @param {{retries?: number, backoffs?: number[], headers?: Record<string,string>}} opts
 */
export async function fetchJsonRetry(url, { retries = 3, backoffs = [5000, 15000, 30000], headers = {} } = {}) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        signal: AbortSignal.timeout(20000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = JSON.parse(await res.text())
      if (json && json.success === false) throw new Error(`success:false ${json.message ?? ''}`) // null 是合法响应（无数据），放行
      return json
    } catch (e) {
      lastErr = e
      if (i === retries) break
      const wait = backoffs[i] ?? 30000
      console.warn(`  请求失败（${e.message}），${wait / 1000}s 后第 ${i + 1} 次重试…`)
      await sleep(wait)
    }
  }
  throw new Error(`请求失败（已重试 ${retries} 次）：${lastErr?.message}`)
}

/**
 * GET 文本（支持指定字符集，如腾讯 qt.gtimg.cn 的 GBK），失败退避重试，重试仍失败抛错。
 * @param {string} url
 * @param {{charset?: string, retries?: number, backoffs?: number[], headers?: Record<string,string>}} opts
 */
export async function fetchTextRetry(
  url,
  { charset = 'utf-8', retries = 3, backoffs = [5000, 15000, 30000], headers = {} } = {}
) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        signal: AbortSignal.timeout(20000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return new TextDecoder(charset).decode(Buffer.from(await res.arrayBuffer()))
    } catch (e) {
      lastErr = e
      if (i === retries) break
      const wait = backoffs[i] ?? 30000
      console.warn(`  请求失败（${e.message}），${wait / 1000}s 后第 ${i + 1} 次重试…`)
      await sleep(wait)
    }
  }
  throw new Error(`请求失败（已重试 ${retries} 次）：${lastErr?.message}`)
}
