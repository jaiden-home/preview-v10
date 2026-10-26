import type { KLineData } from 'klinecharts'
import type { QuoteSnapshot } from '../../chart/types'
import type { ScreenerCondition, ScreenerResultItem, ScreenerRunRequest, ScreenerRunView } from '../../screener/types'
import { matchesAll, matchesAnyDayInRange, truncateBarsAsOf, endOfDayTs } from '../../screener/indicators'
import { screenerIndicatorOf } from '../../screener/types'
import { screenerRequestError } from '../../screener/validate'
import { TTLCache } from '../cache'
import {
  fetchQuotesResilient,
  getEnrichedScreenerUniverse,
  getScreenerUniverse,
  loadBarsBatch,
  MarketDbMissingError,
  type UniverseEntry
} from './universe'

export { MarketDbMissingError }

// ==================== 量化选股编排（仅服务端，market.db 数据源） ====================
// 分片渐进模型：同参数（条件 + 池）的运行状态按 key 缓存 10min，游标推进、命中累积；
// done=false 时客户端带同参数继续请求直至完成——服务端无 job 表，天然可恢复。
// 日 K 直读 kline_daily（单分片一条 SQL），单请求按时间预算连算多片，轮询次数大幅下降。

/** 每片标的数（单条 IN 查询，控制内存与单请求时长） */
const SLICE_SIZE = 400

/** 单请求计算时间预算（连算多片直至超限，余量留给响应传输） */
const REQUEST_BUDGET_MS = 1_200

/** 命中结果行情刷新批量（现价/涨跌幅展示值） */
const REFRESH_BATCH = 80
const REFRESH_CONCURRENCY = 4

interface ScreenerState {
  /** 待技术计算的池（基本面预筛后） */
  pool: UniverseEntry[]
  /** pool 游标（已计算到此） */
  cursor: number
  matched: ScreenerResultItem[]
}

const stateCache = new TTLCache<ScreenerState>({ maxEntries: 64, defaultTtlMs: 10 * 60 * 1000 })

const codeOf = (entry: { market: string; ticker: string }): string => `${entry.market}${entry.ticker}`

/** 稳定状态 key：条件 + 日期区间（同一前端会话重复运行 / 分片续算命中同一状态） */
const stateKeyOf = (request: ScreenerRunRequest): string =>
  `screener:run:${request.from ?? ''}~${request.asOf ?? ''}:${JSON.stringify(request.conditions)}`

/** 基本面条件（快照即可判定，无需日 K） */
const fundamentalConditions = (conditions: ScreenerCondition[]): ScreenerCondition[] =>
  conditions.filter((condition) => screenerIndicatorOf(condition.key)?.kind === 'fundamental')

const hasTechnicalCondition = (conditions: ScreenerCondition[]): boolean =>
  conditions.some((condition) => screenerIndicatorOf(condition.key)?.kind === 'technical')

/** 基本面条件求值（bars = null；命中时顺带产出展示值） */
const evalFundamental = (
  entry: UniverseEntry,
  conditions: ScreenerCondition[]
): { pass: boolean; values: Record<string, number | null> } =>
  matchesAll(conditions, { bars: null, fundamental: entry.fundamental })

/** 命中交易日的本地 yyyy-mm-dd（结果表命中日列） */
const localDateOf = (ts: number): string => {
  const date = new Date(ts)
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

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

/** 命中标的批量刷新行情（结果表现价/涨跌幅保持新鲜；失败保留 --） */
const refreshQuotes = async (items: ScreenerResultItem[]): Promise<void> => {
  if (items.length === 0) {
    return
  }
  const quoteMap = new Map<string, QuoteSnapshot>()
  const batches: Array<ScreenerResultItem[]> = []
  for (let i = 0; i < items.length; i += REFRESH_BATCH) {
    batches.push(items.slice(i, i + REFRESH_BATCH))
  }
  const results = await runWithConcurrency(
    batches.map(
      (batch) => () =>
        fetchQuotesResilient(
          batch.map((item) => ({ market: item.code.slice(0, 2), ticker: item.code.slice(2) }))
        ).catch(() => [])
    ),
    REFRESH_CONCURRENCY
  )
  for (const quotes of results) {
    for (const quote of quotes) {
      quoteMap.set(`${quote.market}${quote.ticker}`, quote)
    }
  }
  for (const item of items) {
    const quote = quoteMap.get(item.code)
    if (quote != null) {
      item.price = quote.price
      item.changePct =
        quote.price != null && quote.prevClose != null && quote.prevClose > 0
          ? ((quote.price - quote.prevClose) / quote.prevClose) * 100
          : null
    }
  }
}

/** 单标的求值（当前/历史两模式；历史模式区间扫描取最近命中日） */
const evaluateEntry = (
  entry: UniverseEntry,
  rawBars: KLineData[] | null,
  request: ScreenerRunRequest,
  historical: boolean
): ScreenerResultItem | null => {
  if (historical) {
    // 区间扫描：日 K 截断到截止日（保留起始日前的历史供指标回看），基本面逐日按收盘/现价比例回溯
    const bars = request.asOf != null && rawBars != null ? truncateBarsAsOf(rawBars, request.asOf) : rawBars
    const startTs = request.from != null ? (endOfDayTs(request.from) ?? 0) : 0
    const endTs = request.asOf != null ? (endOfDayTs(request.asOf) ?? 0) : Number.POSITIVE_INFINITY
    const scan = matchesAnyDayInRange(
      request.conditions,
      { bars, fundamental: entry.fundamental, markPrice: entry.price },
      { startTs, endTs }
    )
    if (!scan.pass || bars == null) {
      return null
    }
    const hit = bars[scan.hitIndex]!
    const prevClose = scan.hitIndex > 0 ? bars[scan.hitIndex - 1]!.close : hit.open
    return {
      code: codeOf(entry),
      name: entry.name,
      price: hit.close,
      changePct: prevClose > 0 ? ((hit.close - prevClose) / prevClose) * 100 : null,
      values: scan.values,
      hitDate: localDateOf(hit.timestamp)
    }
  }
  const { pass, values } = matchesAll(request.conditions, { bars: rawBars, fundamental: entry.fundamental })
  if (!pass) {
    return null
  }
  return { code: codeOf(entry), name: entry.name, price: null, changePct: null, values }
}

/**
 * 运行一次筛选（分片 + 时间预算）：首次调用构建状态（池 + 基本面预筛），此后按游标续算；
 * 当前模式完成时对命中结果刷新行情；as-of 模式下现价/涨跌幅直接取截止日收盘。
 */
export const runScreener = async (request: ScreenerRunRequest): Promise<ScreenerRunView> => {
  const validation = screenerRequestError(request)
  if (validation != null) {
    throw new ScreenerValidationError(validation)
  }

  const key = stateKeyOf(request)
  const state = stateCache.get(key) ?? (await buildState(request, key))

  const historical = request.from != null || request.asOf != null
  // 历史模式（起始/截止区间或单日 as-of）基本面逐日回溯口径求值（依赖日 K），恒走分片路径
  const technical = hasTechnicalCondition(request.conditions) || historical
  if (technical) {
    const startedAt = Date.now()
    while (state.cursor < state.pool.length) {
      const slice = state.pool.slice(state.cursor, state.cursor + SLICE_SIZE)
      if (slice.length === 0) {
        break
      }
      const barsList = await loadBarsBatch(slice)
      for (let i = 0; i < slice.length; i++) {
        const item = evaluateEntry(slice[i]!, barsList[i], request, historical)
        if (item != null) {
          state.matched.push(item)
        }
      }
      state.cursor += slice.length
      if (Date.now() - startedAt >= REQUEST_BUDGET_MS) {
        break
      }
    }
    // 状态回写（TTL 顺延，支持长跑分片）
    stateCache.set(key, state)
  }

  const done = !technical || state.cursor >= state.pool.length
  if (done && !historical) {
    await refreshQuotes(state.matched)
  }

  return {
    done,
    computed: technical ? state.cursor : state.pool.length,
    total: state.pool.length,
    items: state.matched
  }
}

/** 构建运行状态：池解析（24h 缓存）+ 基本面预筛（历史模式跳过——逐日回溯须待日 K） */
const buildState = async (request: ScreenerRunRequest, key: string): Promise<ScreenerState> => {
  // 含基本面条件 → 回填行情快照（现价/基本面）；纯技术策略零上游依赖
  const universe = await (fundamentalConditions(request.conditions).length > 0
    ? getEnrichedScreenerUniverse()
    : getScreenerUniverse())

  const technical = hasTechnicalCondition(request.conditions) || request.from != null || request.asOf != null
  const fundamental = fundamentalConditions(request.conditions)
  const pool: UniverseEntry[] = []
  const matched: ScreenerResultItem[] = []

  for (const entry of universe) {
    if (request.from != null || request.asOf != null || fundamental.length === 0) {
      pool.push(entry)
      continue
    }
    const { pass, values } = evalFundamental(entry, fundamental)
    if (!pass) {
      continue
    }
    if (technical) {
      // 技术条件在前：基本面通过者进入待算池
      pool.push(entry)
    } else {
      // 纯基本面条件：预筛即终判，直接产出命中
      matched.push({
        code: codeOf(entry),
        name: entry.name,
        price: null,
        changePct: null,
        values
      })
    }
  }

  // 纯基本面运行：pool 承载全量口径（进度 100%），技术运行：pool = 预筛后待算池
  const state: ScreenerState = { pool: technical ? pool : universe, cursor: technical ? 0 : universe.length, matched }
  stateCache.set(key, state)
  return state
}

/** 业务校验错误（路由映射 422，文案透传双语目录格式） */
export class ScreenerValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScreenerValidationError'
  }
}
