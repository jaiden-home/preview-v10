import { SCREENER_MAX_CONDITIONS, screenerIndicatorOf, type ScreenerCondition, type ScreenerRunRequest } from './types'

// ==================== 筛选条件校验（双端共用：服务端 zod 之后的业务护栏，客户端即时反馈） ====================

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/**
 * 条件组合校验：指标 key 合法、参数齐全且在登记范围、运算符被指标允许、阈值配套（gt/lt 带 value，between 带 min≤max）。
 * 返回首条错误文案（双语），通过返回 null。
 */
export const screenerConditionsError = (conditions: ScreenerCondition[]): string | null => {
  if (conditions.length === 0) {
    return '至少添加一条筛选条件|Add at least one condition'
  }
  if (conditions.length > SCREENER_MAX_CONDITIONS) {
    return `条件数量最多 ${SCREENER_MAX_CONDITIONS} 条|At most ${SCREENER_MAX_CONDITIONS} conditions`
  }
  for (const condition of conditions) {
    const meta = screenerIndicatorOf(condition.key)
    if (meta == null) {
      return '存在未登记的指标|Unknown indicator'
    }
    if (meta.boolean) {
      if (condition.op !== 'bool') {
        return '布尔指标仅支持命中判断|Boolean indicator only supports match'
      }
      continue
    }
    if (condition.op !== 'gt' && condition.op !== 'lt' && condition.op !== 'between') {
      return '数值指标不支持该运算符|Operator not allowed for numeric indicator'
    }
    for (const param of meta.params) {
      const value = condition.params[param.name]
      if (!isFiniteNumber(value) || !Number.isInteger(value) || value < param.min || value > param.max) {
        return `参数 ${param.label} 须为 ${param.min}~${param.max} 的整数|Param ${param.label} must be integer in ${param.min}-${param.max}`
      }
    }
    if (condition.op === 'gt' || condition.op === 'lt') {
      if (!isFiniteNumber(condition.value)) {
        return '比较条件缺少阈值|Missing threshold value'
      }
    } else if (condition.op === 'between') {
      if (!isFiniteNumber(condition.min) || !isFiniteNumber(condition.max) || condition.min > condition.max) {
        return '区间条件须满足下限 ≤ 上限|Range requires min ≤ max'
      }
    }
  }
  return null
}

/** 截止日期允许的最远回看天数（指标最长回看 250 日 + as-of 一年内的产品口径） */
export const SCREENER_AS_OF_MAX_DAYS = 365

/** 单个日期字段校验（格式 / 非滚动 / 历史日期 / 近一年），通过返回 null */
const dateFieldError = (value: string): string | null => {
  const ts = Date.parse(`${value}T00:00:00`)
  const parsed = Number.isFinite(ts) ? new Date(ts) : null
  const normalized =
    parsed == null
      ? null
      : `${parsed.getFullYear()}-${`${parsed.getMonth() + 1}`.padStart(2, '0')}-${`${parsed.getDate()}`.padStart(2, '0')}`
  // 日期组件越界（如 02-31）会被引擎滚动到下月，规范化后与输入不一致即视为非法
  if (normalized !== value) {
    return '日期格式须为 yyyy-mm-dd|Date must be yyyy-mm-dd'
  }
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  if (ts >= startOfToday) {
    return '日期须为历史日期|Date must be in the past'
  }
  if (ts < startOfToday - SCREENER_AS_OF_MAX_DAYS * 86_400_000) {
    return '日期仅支持最近一年内|Date must be within the last year'
  }
  return null
}

/** 运行请求校验（含日期区间） */
export const screenerRequestError = (request: ScreenerRunRequest): string | null => {
  const conditionError = screenerConditionsError(request.conditions)
  if (conditionError != null) {
    return conditionError
  }
  if (request.from != null) {
    const error = dateFieldError(request.from)
    if (error != null) {
      return error
    }
  }
  if (request.asOf != null) {
    const error = dateFieldError(request.asOf)
    if (error != null) {
      return error
    }
  }
  if (request.from != null && request.asOf != null && request.from > request.asOf) {
    return '起始日期须不晚于截止日期|From date must be on or before as-of date'
  }
  return null
}
