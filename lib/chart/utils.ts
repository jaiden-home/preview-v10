import type { KLineData, Period } from 'klinecharts'

/** 科创板（688/689）每手 200 股，且腾讯分时接口的量为「股」；其余板块每手 100 股，量为「手」 */
export const isCnStarMarket = (symbol: { market?: unknown; ticker: string }): boolean =>
  symbol.market === 'sh' && /^(688|689)/.test(symbol.ticker)

/** 市场指数：沪 000、深 399、北 899 开头（按市场前缀区分同名个股，如 sh000001 上证指数 / sz000001 平安银行） */
export const isCnIndex = (symbol: { market?: unknown; ticker: string }): boolean =>
  (symbol.market === 'sh' && /^000/.test(symbol.ticker)) ||
  (symbol.market === 'sz' && /^399/.test(symbol.ticker)) ||
  (symbol.market === 'bj' && /^899/.test(symbol.ticker))

export const localDayKey = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** 按代码前缀推断市场（60/68/900 → sh，43/83/87/88/92 → bj，其余 → sz） */
export const guessCnMarket = (code: string): string => {
  if (/^(60|68|900)/.test(code)) return 'sh'
  if (/^(43|83|87|88|92)/.test(code)) return 'bj'
  if (/^(00|20|30)/.test(code)) return 'sz'
  return 'sz'
}

export const parseCnBarTime = (value: string): number => {
  if (value.includes('-')) {
    // 补全时间部分，避免纯日期被按 UTC 解析（需与分钟线一致按本地时区）
    const normalized = value.includes(':') ? value.replace(' ', 'T') : `${value}T00:00:00`
    return new Date(normalized).getTime()
  }
  if (/^\d{12}$/.test(value)) {
    return new Date(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}`
    ).getTime()
  }
  if (/^\d{8}$/.test(value)) {
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`).getTime()
  }
  return Number.NaN
}

/** 腾讯 K 线行解析：时间, 开, 收, 高, 低, 量 */
export const parseTencentKlines = (rows: unknown[]): KLineData[] =>
  rows
    .map((row): KLineData | null => {
      if (!Array.isArray(row) || row.length < 6) {
        return null
      }
      const timestamp = parseCnBarTime(String(row[0]))
      if (Number.isNaN(timestamp)) {
        return null
      }
      return {
        timestamp,
        open: Number(row[1]),
        close: Number(row[2]),
        high: Number(row[3]),
        low: Number(row[4]),
        volume: Number(row[5])
      }
    })
    .filter((d): d is KLineData => d != null)

/** 按毫秒桶聚合（用于腾讯不直接提供的周期，如 4 小时） */
export const aggregateBars = (dataList: KLineData[], spanMillis: number): KLineData[] => {
  const buckets = new Map<number, KLineData>()
  for (const bar of dataList) {
    const key = Math.floor(bar.timestamp / spanMillis) * spanMillis
    const prev = buckets.get(key)
    if (prev == null) {
      buckets.set(key, { ...bar, timestamp: key })
    } else {
      prev.high = Math.max(prev.high, bar.high)
      prev.low = Math.min(prev.low, bar.low)
      prev.close = bar.close
      prev.volume = (prev.volume ?? 0) + (bar.volume ?? 0)
      prev.turnover = (prev.turnover ?? 0) + (bar.turnover ?? 0)
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp)
}

export const formatTencentDate = (timestamp: number): string => {
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 从最近若干日 K 中取展示日的前收盘价 */
export const pickPrevClose = (days: KLineData[], displayedDayKey: string, fallback: number): number => {
  if (days.length === 0) {
    return fallback
  }
  const index = days.findIndex((d) => localDayKey(d.timestamp) === displayedDayKey)
  if (index > 0) {
    return days[index - 1].close
  }
  // 盘中日线尚未生成时，最近一根日线即展示日的昨日
  if (index === -1) {
    return days[days.length - 1].close
  }
  return days[0].open
}

export const periodSpanMillis = (period: Period, timespanMillis: Record<Period['type'], number>): number =>
  period.span * timespanMillis[period.type]
