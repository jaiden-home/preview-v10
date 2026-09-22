import { describe, expect, it, vi } from 'vitest'

describe('provider registry', () => {
  it('默认返回 tencent 实例且进程内单例', async () => {
    vi.resetModules()
    delete process.env.DATA_PROVIDER
    const { getProvider } = await import('./registry')
    expect(getProvider().id).toBe('tencent')
    expect(getProvider()).toBe(getProvider())
  })

  it('未知 DATA_PROVIDER 启动期快速失败', async () => {
    vi.resetModules()
    process.env.DATA_PROVIDER = 'unknown'
    try {
      // 非法值在 env zod 校验或 registry 兜底处快速失败（不落到运行期请求）
      await expect(import('./registry').then((m) => m.getProvider())).rejects.toThrow(/DATA_PROVIDER/)
    } finally {
      delete process.env.DATA_PROVIDER
    }
  })
})
