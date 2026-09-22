import { getEnv } from '../../env'
import { logger } from '../../logger'
import { ProviderError } from '../types'

// ==================== 腾讯上游传输（UA 伪装 · GBK 解码 · 超时） ====================

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** 腾讯上游错误（归一为 ProviderError，路由层统一映射 502） */
export class UpstreamError extends ProviderError {
  constructor(
    message: string,
    readonly upstream: string
  ) {
    super(message, 'tencent')
    this.name = 'UpstreamError'
  }
}

export const fetchUpstream = async (url: string): Promise<Response> => {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://gu.qq.com/' },
    signal: AbortSignal.timeout(getEnv().UPSTREAM_TIMEOUT_MS),
    // 服务端代理每次都要拿到最新行情，绕过 Next 数据缓存
    cache: 'no-store'
  })
  if (!response.ok) {
    throw new UpstreamError(`upstream responded ${response.status}`, url)
  }
  return response
}

export const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetchUpstream(url)
  return (await response.json()) as T
}

/** 腾讯部分接口返回 GBK 编码文本 */
export const fetchGbkText = async (url: string): Promise<string> => {
  const response = await fetchUpstream(url)
  const buffer = await response.arrayBuffer()
  try {
    return new TextDecoder('gbk').decode(buffer)
  } catch (error) {
    // Node 构建未携带完整 ICU 时降级（中文可能乱码，但不阻断行情数字段）
    logger.warn({ err: String(error), url }, 'gbk decode unavailable, falling back to utf-8')
    return new TextDecoder('utf-8').decode(buffer)
  }
}
