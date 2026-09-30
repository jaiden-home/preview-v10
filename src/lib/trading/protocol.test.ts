import { describe, expect, it } from 'vitest'
import { advanceSessionBy, changeSessionSpeed, type SimSession } from './protocol'

// ==================== 服务端时钟推进（客户端派生与服务端结算共用） ====================

const session = (overrides: Partial<SimSession> = {}): SimSession => ({
  status: 'running',
  speedMs: 10_000,
  anchorCode: 'sh600519',
  startDate: '2024-06-03',
  dayCount: 5,
  dayIndex: 1,
  lastTickAt: 1_000_000,
  ...overrides
})

describe('advanceSessionBy（服务端时钟推进）', () => {
  it('不足一个倍速时长不推进（原引用返回，可作相等判据）', () => {
    const base = session()
    expect(advanceSessionBy(base, 1_000_000 + 9_999)).toBe(base)
  })

  it('推进整数日并保留余数进度', () => {
    const next = advanceSessionBy(session(), 1_000_000 + 10_000 * 2 + 4_000)
    expect(next.dayIndex).toBe(3)
    expect(next.lastTickAt).toBe(1_000_000 + 20_000)
    expect(next.status).toBe('running')
  })

  it('走满 dayCount 置 ended 且 dayIndex 不越界', () => {
    const next = advanceSessionBy(session(), 1_000_000 + 10_000 * 100)
    expect(next.dayIndex).toBe(5)
    expect(next.status).toBe('ended')
  })

  it('paused/ended 原样返回', () => {
    const paused = session({ status: 'paused' })
    expect(advanceSessionBy(paused, 1_000_000 + 999_999)).toBe(paused)
    const ended = session({ status: 'ended', dayIndex: 5 })
    expect(advanceSessionBy(ended, 1_000_000 + 999_999)).toBe(ended)
  })

  it('时钟早于锚点（跨端时钟偏差）不倒退', () => {
    const base = session()
    expect(advanceSessionBy(base, 999_000)).toBe(base)
  })
})

describe('changeSessionSpeed（倍速热切换）', () => {
  it('running：当前日进度比例不变，折算新倍速计时锚点', () => {
    const now = 1_000_000 + 5_000 // 进度 50%
    const next = changeSessionSpeed(session(), 2_000, now)
    expect(next.speedMs).toBe(2_000)
    expect(next.lastTickAt).toBe(now - 1_000) // 50% × 2s
    // 进度语义连续：剩余 1s 走完当前日
    expect(advanceSessionBy(next, now + 1_000).dayIndex).toBe(2)
  })

  it('paused：仅换 speedMs（继续时重新计时）', () => {
    const paused = session({ status: 'paused' })
    const next = changeSessionSpeed(paused, 5_000, 9_999_999)
    expect(next).toMatchObject({ status: 'paused', speedMs: 5_000, lastTickAt: paused.lastTickAt })
  })

  it('ended / 同倍速原样返回', () => {
    const ended = session({ status: 'ended', dayIndex: 5 })
    expect(changeSessionSpeed(ended, 2_000, 9)).toBe(ended)
    const base = session()
    expect(changeSessionSpeed(base, 10_000, 9)).toBe(base)
  })
})
