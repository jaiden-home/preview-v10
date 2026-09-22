import type { KLineData, Period } from 'klinecharts'
import type { QuoteSnapshot, SymbolRef, SymbolSearchItem, TimeShareSnapshot } from '../../chart/types'

/** 数据源能力声明：缺失的能力由 market-service 统一降级 */
export interface ProviderCapabilities {
  /** 有原生分时接口（false 时降级为当日 1 分钟 K 合成） */
  timeShare: boolean
  /** 支持名称/拼音联想搜索（false 时降级为 6 位代码精确匹配） */
  search: boolean
  /** 原生支持的周期键（PERIOD_OPTIONS 的 key）；缺口周期（如 4h）由 provider 拉取基周期后本地聚合 */
  periods: readonly string[]
}

/**
 * 行情数据源统一契约。
 * 入参与返回均为领域模型（与 BFF 响应一致）：切换数据源时路由与前端零改动，
 * 新数据源上线门槛 = 实现本接口 + 通过契约测试（provider/contract.ts）。
 */
export interface MarketDataProvider {
  readonly id: string
  readonly capabilities: ProviderCapabilities
  fetchQuote(symbol: SymbolRef): Promise<QuoteSnapshot>
  fetchKLines(symbol: SymbolRef, period: Period, from: number, to: number): Promise<KLineData[]>
  fetchTimeShare(symbol: SymbolRef): Promise<TimeShareSnapshot>
  searchSymbols(query: string): Promise<SymbolSearchItem[]>
}

/** 数据源错误：路由层统一捕获并映射为 502 upstream_error */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
