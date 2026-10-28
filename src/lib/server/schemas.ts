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

/** 行情中心总览（/api/market）：board/sort/dir 控制榜单视图，symbols 携带自选代码批量刷新行情 */
export const marketQuerySchema = z.object({
  board: z.enum(['industry', 'concept']).default('industry'),
  sort: z.enum(['changePct', 'turnover']).default('changePct'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  symbols: z.string().trim().max(240, 'too many symbols').optional()
})

/** 回放视图（/api/sim/replay）：symbol 之外无参数——窗口（起始日/结束日/根数）由服务端从当前会话解析 */
export const replayQuerySchema = z.object({
  symbol: symbolField
})

/** 模拟交易下单（/api/sim/orders）：价格/数量由服务端权威校验（涨跌停/整手/资金/T+1） */
export const simOrderSchema = z.object({
  side: z.enum(['buy', 'sell']),
  code: symbolField,
  price: z.coerce.number().positive(),
  qty: z.coerce.number().int().positive(),
  name: z.string().trim().max(20).optional()
})

/** 每交易日真实毫秒（倍速档位见 REPLAY_SPEED_PRESETS_MS；1s~60s 整数护栏） */
const speedMsField = z
  .number()
  .int()
  .min(1_000, 'speedMs must be 1000-60000ms')
  .max(60_000, 'speedMs must be 1000-60000ms')

/** 模拟交易会话控制（/api/sim/session）：start 可带 speedMs（倍速档位），speed 会话内热切换 */
export const simSessionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    anchorCode: symbolField,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be yyyy-mm-dd'),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be yyyy-mm-dd')
      .optional(),
    paused: z.boolean().optional(),
    speedMs: speedMsField.optional()
  }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('speed'), speedMs: speedMsField }),
  z.object({ action: z.literal('restart') })
])

/** 概念管理（/api/admin/concepts）：概念名/大类名 1~30 字符；动作语义见 lib/concepts.ts */
const conceptNameField = z.string().trim().min(1, 'concept name is required').max(30, 'concept name is too long')
const categoryNameField = z.string().trim().min(1, 'category name is required').max(30, 'category name is too long')
const stockCodeField = z.string().regex(/^\d{6}$/, 'code must be a 6-digit stock code')

export const conceptAdminSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: conceptNameField, category: categoryNameField }),
  z
    .object({
      action: z.literal('update'),
      name: conceptNameField,
      nextName: conceptNameField.optional(),
      nextCategory: categoryNameField.optional()
    })
    .refine((body) => body.nextName != null || body.nextCategory != null, {
      message: 'nextName or nextCategory is required'
    }),
  z.object({ action: z.literal('delete'), name: conceptNameField }),
  z.object({ action: z.literal('rename-category'), category: categoryNameField, next: categoryNameField }),
  z.object({ action: z.literal('set-member'), code: stockCodeField, concept: conceptNameField.nullable() }),
  z.object({ action: z.literal('reorder'), name: conceptNameField, dir: z.enum(['up', 'down']) })
])

export type KlineQuery = z.infer<typeof klineQuerySchema>
export type SearchQuery = z.infer<typeof searchQuerySchema>
export type ReplayQuery = z.infer<typeof replayQuerySchema>
export type SimOrderBody = z.infer<typeof simOrderSchema>
export type SimSessionBody = z.infer<typeof simSessionSchema>
export type ConceptAdminBody = z.infer<typeof conceptAdminSchema>
