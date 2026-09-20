import { expect, test } from '@playwright/test'

test.describe('SSR 冒烟', () => {
  test('首页：服务端直出信息表格与元数据，图表客户端水合', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/KLineChart/)
    // SSR 直出的信息表格（禁用 JS 时也存在；启用 JS 后由真实数据填充）
    await expect(page.locator('#info-table')).toBeVisible()
    // klinecharts 水合后出现 canvas
    await expect(page.locator('#container canvas').first()).toBeVisible({ timeout: 20_000 })
  })

  test('动态标的路由：/sh600519 返回 200 且水合出图表', async ({ page }) => {
    const response = await page.goto('/sh600519')
    expect(response?.status()).toBe(200)
    // 标题含标的代码（上游可用时为「贵州茅台(sh600519)」，不可用时回退代码）
    await expect(page).toHaveTitle(/600519/, { timeout: 20_000 })
    await expect(page.locator('#container canvas').first()).toBeVisible({ timeout: 20_000 })
  })

  test('非法标的路由返回 404', async ({ page }) => {
    const response = await page.goto('/not-a-symbol')
    expect(response?.status()).toBe(404)
  })

  test('健康检查端点', async ({ request }) => {
    const response = await request.get('/api/healthz')
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    expect(body.status).toBe('ok')
  })

  test('BFF kline 接口拒绝非法参数', async ({ request }) => {
    const bad = await request.get('/api/kline?symbol=600519&period=1d&from=1&to=2')
    expect(bad.status()).toBe(400)
    const body = await bad.json()
    expect(body.error.code).toBe('invalid_params')
  })
})
