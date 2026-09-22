import type { Period } from 'klinecharts'
import { TIMESPAN_MILLIS } from '../../chart/constants'

export interface PeriodPlan {
  /** 实际向上游请求的周期（数据源原生支持） */
  base: Period
  /** 原始周期不支持时的本地聚合步长（毫秒）；null = 无需聚合 */
  aggregateMillis: number | null
}

/** 周期兜底基期：小时族退到 1 小时线，其余（日/周/月）退到日线 */
const basePeriodOf = (period: Period): Period =>
  period.type === 'hour' ? { span: 1, type: 'hour' } : { span: 1, type: 'day' }

/**
 * 周期解析计划：数据源原生支持的周期直接透传；
 * 不支持的周期（如腾讯无 4 时线）改用基周期拉取，由调用方按聚合步长本地合成。
 */
export const planPeriod = (requested: Period, isSupported: (period: Period) => boolean): PeriodPlan => {
  if (isSupported(requested)) {
    return { base: requested, aggregateMillis: null }
  }
  return { base: basePeriodOf(requested), aggregateMillis: requested.span * TIMESPAN_MILLIS[requested.type] }
}
