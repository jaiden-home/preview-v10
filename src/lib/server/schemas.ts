import { z } from 'zod'

const symbolField = z.string().regex(/^(sh|sz|bj)\d{6}$/, 'symbol must be market prefix (sh/sz/bj) + 6-digit code')

export const quoteQuerySchema = z.object({ symbol: symbolField })

export const timeShareQuerySchema = z.object({ symbol: symbolField })

export const klinePeriodSchema = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'])

export const klineQuerySchema = z
  .object({
    symbol: symbolField,
    period: klinePeriodSchema,
    from: z.coerce.number().int().positive(),
    to: z.coerce.number().int().positive()
  })
  .refine((query) => query.from < query.to, { message: 'from must be less than to' })

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'query is required').max(40, 'query is too long')
})

/** 回放数据：目标根数（2~5000，默认 800；BFF 按页回溯至上市/数据尽头） */
export const replayQuerySchema = z.object({
  symbol: symbolField,
  bars: z.coerce.number().int().min(2).max(5000).default(800)
})

/** 模拟交易倍速档位（与 lib/trading/replay 的 REPLAY_SPEEDS 保持同步） */
const simSpeedField = z.union([z.literal(15_000), z.literal(30_000), z.literal(60_000)])

/** 模拟交易下单（/api/sim/orders）：价格/数量由服务端权威校验（涨跌停/整手/资金/T+1） */
export const simOrderSchema = z.object({
  side: z.enum(['buy', 'sell']),
  code: symbolField,
  price: z.coerce.number().positive(),
  qty: z.coerce.number().int().positive(),
  name: z.string().trim().max(20).optional()
})

/** 模拟交易会话控制（/api/sim/session） */
export const simSessionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    anchorCode: symbolField,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be yyyy-mm-dd'),
    speedMs: simSpeedField
  }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('speed'), speedMs: simSpeedField }),
  z.object({ action: z.literal('restart') })
])

export type KlineQuery = z.infer<typeof klineQuerySchema>
export type SearchQuery = z.infer<typeof searchQuerySchema>
export type ReplayQuery = z.infer<typeof replayQuerySchema>
export type SimOrderBody = z.infer<typeof simOrderSchema>
export type SimSessionBody = z.infer<typeof simSessionSchema>
