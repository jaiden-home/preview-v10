import { describe, expect, it } from 'vitest'
import { parseStrategyRange } from './types'

// 时间范围参数解析：单边非法丢该边，双边倒置整体回退默认窗口（null）
describe('parseStrategyRange', () => {
  it('缺省 / 空串 / 双边均非法返回 null（默认窗口）', () => {
    expect(parseStrategyRange()).toBeNull()
    expect(parseStrategyRange('', '')).toBeNull()
    expect(parseStrategyRange('not-a-date', null)).toBeNull()
  })

  it('越界日期（月/日不存在）按非法处理', () => {
    expect(parseStrategyRange('2026-13-01', null)).toBeNull()
    expect(parseStrategyRange(null, '2026-02-30')).toBeNull()
  })

  it('单边格式非法只丢弃该边，合法边仍生效', () => {
    expect(parseStrategyRange('2026/08/01', '2026-08-31')).toEqual({ to: '2026-08-31' })
  })

  it('合法日期构造区间，支持单边覆盖', () => {
    expect(parseStrategyRange('2026-08-01', '2026-08-31')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(parseStrategyRange('2026-08-01', null)).toEqual({ from: '2026-08-01' })
    expect(parseStrategyRange(undefined, '2026-08-31')).toEqual({ to: '2026-08-31' })
  })

  it('区间倒置（from > to）整体视为未设置', () => {
    expect(parseStrategyRange('2026-09-01', '2026-08-01')).toBeNull()
  })
})
