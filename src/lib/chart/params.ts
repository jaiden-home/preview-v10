import { INDICATOR_PARAM_META } from './constants'
import type { Translate } from '../i18n'

/** 弹窗参数行描述（由指标 calcParams 与元数据生成） */
export interface ParamRowMeta {
  label: string
  value: number
  min: number
  step: number
}

export const buildParamRowMetas = (calcParams: number[], name: string, t: Translate): ParamRowMeta[] =>
  calcParams.map((value, index) => {
    const meta = INDICATOR_PARAM_META[name]?.[index]
    const label = meta ? t(meta.label) : `${t('参数|Param')} ${index + 1}`
    const min = meta?.min ?? 1
    const step = meta?.decimal === true ? 0.01 : 1
    return { label, value, min, step }
  })

export interface RawParamInput {
  value: string
  min: string
  step: string
}

/**
 * 汇总弹窗输入：空值与低于最小值钳制为 min；
 * step 为 1 的整数参数取整（BOLL 标准差、SAR 等小数参数 step 为 0.01，保留小数）
 */
export const buildCalcParams = (inputs: RawParamInput[]): number[] =>
  inputs.map((input) => {
    const value = parseFloat(input.value)
    const min = parseFloat(input.min || '0')
    const clamped = Number.isNaN(value) ? min : Math.max(value, min)
    return input.step === '1' ? Math.round(clamped) : clamped
  })
