import type { KLineData } from 'klinecharts'
import type { FundamentalData, QuoteSnapshot, SymbolRef } from '../../chart/types'
import { TTLCache } from '../cache'
import { getProvider } from '../provider/registry'

// ==================== 量化选股股票池（仅服务端） ====================
// 池口径（用户指定）：沪深主板全部标的——深市主板 000 段 + 沪市主板 600 段。
// 发现方式：候选代码批量报价探测（qt.gtimg.cn 一次 q= 多标的），名称为空视为无效代码剔除；
// 探测顺带缓存名称与基本面快照（基本面日内基本不变，供条件预筛）。

/** 池代码段：market + 6 位代码闭区间 */
const SEGMENTS: Array<{ market: string; from: number; to: number }> = [
  { market: 'sz', from: 1, to: 999 },
  { market: 'sh', from: 600_000, to: 600_999 }
]

const PROBE_BATCH = 80
const PROBE_CONCURRENCY = 5

/** 池清单缓存 24h（成分变化低频；盘中新股忽略） */
const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000

export interface UniverseEntry {
  market: string
  ticker: string
  name: string
  /** 探测时现价：as-of 基本面比例回溯的定标基准（replayFundamentalOf 口径） */
  price: number | null
  fundamental: FundamentalData
}

const universeCache = new TTLCache<UniverseEntry[]>({ maxEntries: 4, defaultTtlMs: UNIVERSE_TTL_MS })

const candidateCodes = (): Array<{ market: string; ticker: string }> => {
  const codes: Array<{ market: string; ticker: string }> = []
  for (const segment of SEGMENTS) {
    for (let num = segment.from; num <= segment.to; num++) {
      codes.push({ market: segment.market, ticker: String(num).padStart(6, '0') })
    }
  }
  return codes
}

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

/** 主池发现（进程内 24h 缓存；并发批量探测沪深主板代码段） */
export const getScreenerUniverse = (): Promise<UniverseEntry[]> =>
  universeCache.getOrLoad('screener:universe:main', async () => {
    const candidates = candidateCodes()
    const batches: Array<Array<{ market: string; ticker: string }>> = []
    for (let i = 0; i < candidates.length; i += PROBE_BATCH) {
      batches.push(candidates.slice(i, i + PROBE_BATCH))
    }
    const probeResults = await runWithConcurrency(
      batches.map((batch) => () => fetchQuotesResilient(batch).catch(() => [])),
      PROBE_CONCURRENCY
    )
    const entries: UniverseEntry[] = []
    for (const quotes of probeResults) {
      for (const quote of quotes) {
        // 名称非空 = 有效代码；停牌股（price null）保留，交由指标层以缺数据保守过滤
        if (quote.name != null) {
          entries.push({
            market: quote.market,
            ticker: quote.ticker,
            name: quote.name,
            price: quote.price,
            fundamental: quote.fundamental
          })
        }
      }
    }
    entries.sort((a, b) => `${a.market}${a.ticker}`.localeCompare(`${b.market}${b.ticker}`))
    return entries
  })

// ==================== 日 K 长缓存（量化口径：10min，绕开行情 3s 缓存） ====================

const KLINE_TTL_MS = 10 * 60 * 1000
/** 指标最长回看 250 日 + as-of 一年 + EMA 预热，取 700 个自然日窗口（≈470 根日 K，上游单次 640 根内） */
const KLINE_LOOKBACK_DAYS = 700
const DAY_MS = 24 * 60 * 60 * 1000
const KLINE_CONCURRENCY = 8

const barsCache = new TTLCache<KLineData[]>({ maxEntries: 4_000, defaultTtlMs: KLINE_TTL_MS })
const providerRef = () => getProvider()

const loadBars = async (entry: { market: string; ticker: string }): Promise<KLineData[]> =>
  barsCache.getOrLoad(`screener:bars:${entry.market}${entry.ticker}`, async () => {
    const to = Date.now()
    const from = to - KLINE_LOOKBACK_DAYS * DAY_MS
    const bars = await providerRef().fetchKLines(
      { market: entry.market, ticker: entry.ticker },
      { span: 1, type: 'day' },
      from,
      to
    )
    if (bars.length === 0) {
      throw new Error(`no daily bars for ${entry.market}${entry.ticker}`)
    }
    return bars
  })

/** 批量取日 K（长缓存 + 受控并发；失败标的返回 null，不拖垮整片） */
export const loadBarsBatch = async (
  entries: Array<{ market: string; ticker: string }>
): Promise<Array<KLineData[] | null>> =>
  runWithConcurrency(
    entries.map((entry) => () => loadBars(entry).catch(() => null)),
    KLINE_CONCURRENCY
  )
