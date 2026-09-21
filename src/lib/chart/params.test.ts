import { describe, expect, it } from 'vitest'
import { buildCalcParams, buildParamRowMetas, type RawParamInput } from './params'
import { createT } from '../i18n'

const t = createT('zh-CN')

describe('指标参数辅助', () => {
  it('buildParamRowMetas 使用元数据标签、min 与步进', () => {
    const rows = buildParamRowMetas([5, 10, 30, 60], 'MA', t)
    expect(rows.map((r) => r.label)).toEqual(['MA1', 'MA2', 'MA3', 'MA4'])
    expect(rows[0]).toEqual({ label: 'MA1', value: 5, min: 1, step: 1 })
  })

  it('无元数据的指标回退为「参数 N」标签', () => {
    const rows = buildParamRowMetas([3, 7], 'XYZ', t)
    expect(rows.map((r) => r.label)).toEqual(['参数 1', '参数 2'])
  })

  it('BOLL 的标准差参数支持小数（step 0.01 / min 0.1）', () => {
    const rows = buildParamRowMetas([20, 2], 'BOLL', t)
    expect(rows[1]).toEqual({ label: '标准差', value: 2, min: 0.1, step: 0.01 })
  })

  it('空值与低于最小值的输入会被钳制为 min', () => {
    const inputs: RawParamInput[] = [
      { value: '', min: '1', step: '1' },
      { value: '0', min: '1', step: '1' },
      { value: '30', min: '1', step: '1' },
      { value: '60', min: '1', step: '1' }
    ]
    expect(buildCalcParams(inputs)).toEqual([1, 1, 30, 60])
  })

  it('整数参数（step 1）输入小数会被取整，小数参数（step 0.01）保留', () => {
    expect(buildCalcParams([{ value: '5.5', min: '1', step: '1' }])).toEqual([6])
    expect(buildCalcParams([{ value: '2.5', min: '0.1', step: '0.01' }])).toEqual([2.5])
  })
})
