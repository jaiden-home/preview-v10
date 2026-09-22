import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** 上游（腾讯行情）请求超时 */
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(5_000),
  /** 实时行情缓存 TTL（与 3 秒轮询对齐） */
  CACHE_QUOTE_TTL_MS: z.coerce.number().int().min(500).default(2_000),
  /** K 线近端缓存 TTL（与 3 秒轮询对齐，回源频率与用户数无关） */
  CACHE_KLINE_TTL_MS: z.coerce.number().int().min(1_000).default(3_000),
  /** K 线历史窗口缓存 TTL（历史不可变；有界以防除权后前复权全量重算） */
  CACHE_KLINE_HIST_TTL_MS: z.coerce.number().int().min(1_000).default(600_000),
  /** 分时缓存 TTL（与 3 秒轮询对齐） */
  CACHE_TIMESHARE_TTL_MS: z.coerce.number().int().min(500).default(2_000),
  /** 标的搜索缓存 TTL */
  CACHE_SEARCH_TTL_MS: z.coerce.number().int().min(1_000).default(300_000),
  /** 每 IP 每分钟最大请求数（BFF 聚合口） */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(240)
})

export type Env = z.infer<typeof envSchema>

/** 进程内懒解析一次；非法值快速失败（启动期暴露配置问题） */
let parsed: Env | undefined

export const getEnv = (): Env => {
  parsed ??= envSchema.parse(process.env)
  return parsed
}
