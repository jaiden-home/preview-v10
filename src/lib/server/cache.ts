export interface TTLCacheOptions {
  /** 最大条目数（超出按插入序淘汰最旧） */
  maxEntries: number
  /** 默认过期时间（ms） */
  defaultTtlMs: number
}

interface Entry<T> {
  value: T
  expiresAt: number
}

/**
 * 进程内 TTL 缓存（LRU 淘汰 + 过期清扫 + 在途请求去重）。
 * 在途去重保证同一 key 的并发回源只打一次上游，适配多客户端同步轮询。
 * 多实例部署时应替换为 Redis 等共享存储（当前单容器场景够用）。
 */
export class TTLCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly inflight = new Map<string, Promise<T>>()

  constructor(private readonly options: TTLCacheOptions) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (entry == null) {
      return undefined
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    // Map 迭代序即 LRU 序：重插刷新热度
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: T, ttlMs: number = this.options.defaultTtlMs): void {
    if (this.entries.size >= this.options.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next()
      if (!oldest.done) {
        this.entries.delete(oldest.value)
      }
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs })
    this.sweep()
  }

  /** cache-aside：命中直接返回，未命中回源（同 key 并发仅回源一次） */
  async getOrLoad(key: string, loader: () => Promise<T>, ttlMs: number = this.options.defaultTtlMs): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) {
      return cached
    }
    const pending = this.inflight.get(key)
    if (pending != null) {
      return pending
    }
    const task = loader()
      .then((value) => {
        if (value != null) {
          this.set(key, value, ttlMs)
        }
        return value
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, task)
    return task
  }

  /** 删除指定 key（写入方使缓存失效用；在途回源不中断，落地后不再缓存该次结果以外的旧值） */
  delete(key: string): void {
    this.entries.delete(key)
  }

  /** 清理已过期条目，避免长期运行下的内存增长 */
  private sweep(): void {
    if (this.entries.size < this.options.maxEntries * 2) {
      return
    }
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key)
      }
    }
  }
}
