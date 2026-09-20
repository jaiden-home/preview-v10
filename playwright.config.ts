import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // 与 Docker 镜像一致：standalone 产物 + 静态资源副本
        command:
          'npm run build && cp -R .next/static .next/standalone/.next/static && cp -R public .next/standalone/public && node .next/standalone/server.js',
        url: 'http://127.0.0.1:3000/api/healthz',
        reuseExistingServer: !process.env.CI,
        timeout: 240_000
      }
})
