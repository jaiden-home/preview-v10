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

export type KlineQuery = z.infer<typeof klineQuerySchema>
export type SearchQuery = z.infer<typeof searchQuerySchema>
