import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TTLCache } from './cache'
import { SlidingWindowRateLimiter } from './rate-limit'

describe('TTLCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('条目在 TTL 内命中，过期后失效', () => {
    const cache = new TTLCache<number>({ maxEntries: 10, defaultTtlMs: 1_000 })
    cache.set('k', 1)
    expect(cache.get('k')).toBe(1)
    vi.advanceTimersByTime(1_001)
    expect(cache.get('k')).toBeUndefined()
  })

  it('超出 maxEntries 淘汰最旧条目', () => {
    const cache = new TTLCache<number>({ maxEntries: 2, defaultTtlMs: 10_000 })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('getOrLoad 命中缓存不回源，同 key 并发仅回源一次', async () => {
    const cache = new TTLCache<number>({ maxEntries: 10, defaultTtlMs: 1_000 })
    const loader = vi.fn(async () => 42)
    const first = await Promise.all([cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)])
    expect(first).toEqual([42, 42])
    expect(loader).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(500)
    await cache.getOrLoad('k', loader)
    expect(loader).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(600)
    await cache.getOrLoad('k', loader)
    expect(loader).toHaveBeenCalledTimes(2)
  })
})

describe('SlidingWindowRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('窗口内超过限流阈值后拒绝', () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000)
    expect(limiter.check('ip1')).toBe(true)
    expect(limiter.check('ip1')).toBe(true)
    expect(limiter.check('ip1')).toBe(true)
    expect(limiter.check('ip1')).toBe(false)
    // 其他 key 不受影响
    expect(limiter.check('ip2')).toBe(true)
  })

  it('窗口滑动后恢复放行', () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000)
    expect(limiter.check('ip1')).toBe(true)
    expect(limiter.check('ip1')).toBe(true)
    expect(limiter.check('ip1')).toBe(false)
    vi.advanceTimersByTime(60_001)
    expect(limiter.check('ip1')).toBe(true)
  })
})
