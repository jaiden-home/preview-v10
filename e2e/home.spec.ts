import { expect, test } from '@playwright/test'

test.describe('SSR 冒烟', () => {
  test('首页：行情看板与模拟交易两个入口，点击看板进入终端', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/KLineChart/)
    const dashboard = page.getByRole('link', { name: /行情看板|Market Dashboard/ })
    const trade = page.getByRole('link', { name: /模拟交易|Paper Trading/ })
    await expect(dashboard).toBeVisible()
    await expect(trade).toBeVisible()
    await expect(trade).toHaveAttribute('href', '/trade')
    await dashboard.click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator('#container canvas').first()).toBeVisible({ timeout: 20_000 })
  })

  test('主题跨页同步：首页切深色进入看板，页面保持深色且开关一键生效', async ({ page }) => {
    await page.goto('/')
    await page.locator('#theme-btn').click()
    await expect(page.locator('#app')).toHaveClass(/dark/)
    // 客户端导航不重建根节点，#app.dark 随 DOM 保留
    await page.getByRole('link', { name: /行情看板|Market Dashboard/ }).click()
    await expect(page.locator('#container canvas').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#app')).toHaveClass(/dark/)
    // 修复前首击为无效点击（组件重建后 state=false 与 DOM 深色错位）
    await page.locator('#theme-btn').click()
    await expect(page.locator('#app')).not.toHaveClass(/dark/)
  })

  test('看板页：服务端直出信息表格与元数据，图表客户端水合', async ({ page }) => {
    await page.goto('/dashboard')
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
