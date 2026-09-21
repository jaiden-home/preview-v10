/**
 * 进程内滑动窗口限流（按 key，通常为客户端 IP）。
 * 单实例场景够用；多实例部署应替换为 Redis 令牌桶。
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000
  ) {}

  /** 记录一次命中并判断是否放行 */
  check(key: string): boolean {
    const now = Date.now()
    const windowStart = now - this.windowMs
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > windowStart)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > this.maxKeys) {
      // 防泄漏：超量时清掉最旧 key（Map 迭代序）
      const oldest = this.hits.keys().next()
      if (!oldest.done) {
        this.hits.delete(oldest.value)
      }
    }
    return true
  }

  /** 清理空窗口 key */
  sweep(): void {
    const windowStart = Date.now() - this.windowMs
    for (const [key, timestamps] of this.hits) {
      if (timestamps.every((ts) => ts <= windowStart)) {
        this.hits.delete(key)
      }
    }
  }
}

/** 从代理头解析客户端 IP（Docker/Nginx 场景），回退到 unknown */
export const clientKeyFrom = (request: Request): string => {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded != null && forwarded !== '') {
    return forwarded.split(',')[0].trim()
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}
