import type { KLineData } from 'klinecharts'
import type { FundamentalData, QuoteSnapshot, SymbolRef } from '../../chart/types'
import { TTLCache } from '../cache'
import { getMarketDb, marketDbExists } from '../market-db/db'
import { getProvider } from '../provider/registry'

// ==================== 量化选股股票池（仅服务端，market.db 数据源） ====================
// 池口径：market.db stocks.enabled=1（沪深主板 + 创业板启用股全池，名称/归属以库为准）；
// 现价与基本面快照按需经腾讯批量报价回填（含基本面条件时才触发，24h 缓存）；
// 日 K 直接读 kline_daily（不复权快照，与领涨看板同源同口径），不再逐标的拉上游。

/** 快照回填批量与并发（对齐上游批量报价能力） */
const PROBE_BATCH = 80
const PROBE_CONCURRENCY = 5

/** 池清单/快照缓存 24h（成分变化低频；快照日内基本不变） */
const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000

export interface UniverseEntry {
  market: string
  ticker: string
  name: string
  /** 回填现价：as-of 基本面比例回溯的定标基准（replayFundamentalOf 口径）；未回填 = null */
  price: number | null
  fundamental: FundamentalData
}

/** 行情快照库缺失（页面/API 引导复制 market.db） */
export class MarketDbMissingError extends Error {
  constructor() {
    super(
      '行情快照库未就绪：请将 market.db 复制到 dbdata/ 后重试|Market snapshot db missing: copy market.db into dbdata/ first'
    )
    this.name = 'MarketDbMissingError'
  }
}

const universeCache = new TTLCache<UniverseEntry[]>({ maxEntries: 4, defaultTtlMs: UNIVERSE_TTL_MS })

/** 交易所代码 → 应用内市场前缀 */
const marketOf = (exchange: string): string => (exchange === 'SH' ? 'sh' : 'sz')

/** 简易并发池：顺序出队，最多 limit 个在途 */
const runWithConcurrency = async <T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> => {
  const results: T[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++
      results[index] = await tasks[index]()
    }
  })
  await Promise.all(workers)
  return results
}

/** 批量行情（缺批量能力时逐标的降级，单个失败置空价快照） */
export const fetchQuotesResilient = async (symbols: SymbolRef[]): Promise<QuoteSnapshot[]> => {
  const provider = getProvider()
  if (symbols.length === 0) {
    return []
  }
  if (provider.capabilities.batchQuotes && provider.fetchQuotes != null) {
    return provider.fetchQuotes(symbols)
  }
  return Promise.all(
    symbols.map(async (symbol) => {
      try {
        return await provider.fetchQuote(symbol)
      } catch {
        return {
          market: symbol.market,
          ticker: symbol.ticker,
          name: null,
          price: null,
          prevClose: null,
          fundamental: {}
        }
      }
    })
  )
}

/** 主池（market.db 启用股全池；进程内 24h 缓存；price/基本面待按需回填） */
export const getScreenerUniverse = (): Promise<UniverseEntry[]> =>
  universeCache.getOrLoad('screener:universe:db', async () => {
    if (!marketDbExists()) {
      throw new MarketDbMissingError()
    }
    const rows = getMarketDb()
      .prepare('SELECT code, name, exchange FROM stocks WHERE enabled = 1 ORDER BY code')
      .all() as Array<{ code: string; name: string; exchange: string }>
    return rows.map((r) => ({
      market: marketOf(r.exchange),
      ticker: r.code,
      name: r.name,
      price: null,
      fundamental: {}
    }))
  })

/** 主池 + 行情快照回填（现价/涨跌/基本面；含基本面条件的策略用，24h 缓存，首次回填约数十秒） */
export const getEnrichedScreenerUniverse = (): Promise<UniverseEntry[]> =>
  universeCache.getOrLoad('screener:universe:db:enriched', async () => {
    const base = await getScreenerUniverse()
    const batches: Array<UniverseEntry[]> = []
    for (let i = 0; i < base.length; i += PROBE_BATCH) {
      batches.push(base.slice(i, i + PROBE_BATCH))
    }
    const probeResults = await runWithConcurrency(
      batches.map(
        (batch) => () =>
          fetchQuotesResilient(batch.map((e) => ({ market: e.market, ticker: e.ticker }))).catch(() => [])
      ),
      PROBE_CONCURRENCY
    )
    const quoteMap = new Map<string, QuoteSnapshot>()
    for (const quotes of probeResults) {
      for (const quote of quotes) {
        quoteMap.set(`${quote.market}${quote.ticker}`, quote)
      }
    }
    return base.map((entry) => {
      const quote = quoteMap.get(`${entry.market}${entry.ticker}`)
      if (quote == null) {
        return entry // 探测失败保留库内名称，指标层以缺数据保守过滤
      }
      return {
        ...entry,
        price: quote.price,
        fundamental: quote.fundamental
      }
    })
  })

// ==================== 日 K 读取（kline_daily 直读，不复权快照口径） ====================

/** 指标最长回看 250 交易日 + as-of 一年 + EMA 预热，取 700 自然日窗口（≈470 根日 K） */
const KLINE_LOOKBACK_DAYS = 700

const cutoffDate = (): string => {
  const date = new Date(Date.now() - KLINE_LOOKBACK_DAYS * 86_400_000)
  const p = (x: number): string => `${x}`.padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** 批量取日 K（单条 SQL 直读 kline_daily；无 K 线标的返回 null，交由指标层保守过滤） */
export const loadBarsBatch = async (
  entries: Array<{ market: string; ticker: string }>
): Promise<Array<KLineData[] | null>> => {
  if (entries.length === 0) {
    return []
  }
  if (!marketDbExists()) {
    throw new MarketDbMissingError()
  }
  const ph = entries.map(() => '?').join(',')
  const rows = getMarketDb()
    .prepare(
      `SELECT code, trade_date, open, high, low, close, volume FROM kline_daily
       WHERE trade_date >= ? AND code IN (${ph}) ORDER BY code, trade_date`
    )
    .all(cutoffDate(), ...entries.map((e) => e.ticker)) as Array<{
    code: string
    trade_date: string
    open: number
    high: number
    low: number
    close: number
    volume: number
  }>
  const byCode = new Map<string, KLineData[]>()
  for (const r of rows) {
    // 与腾讯日线同口径：本地时区零点时间戳（parseCnBarTime 约定）
    const bars = byCode.get(r.code) ?? []
    bars.push({
      timestamp: new Date(`${r.trade_date}T00:00:00`).getTime(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume
    })
    byCode.set(r.code, bars)
  }
  return entries.map((e) => byCode.get(e.ticker) ?? null)
}
