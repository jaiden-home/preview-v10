import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadBoardSafe } from './board'
import { marketDbPath } from './db'

// 真库冒烟（dbdata/market.db 存在时才执行；CI/其它环境自动跳过）
describe.skipIf(!existsSync(resolve(process.cwd(), 'dbdata/market.db')))('loadBoard 真库冒烟', () => {
  it(
    '加载真实 market.db 并产出完整看板',
    { timeout: 60_000 }, // 冷读 2.4G 库约 7s（OS 页缓存冷时更久），远超默认 5s
    () => {
      const t0 = Date.now()
      const board = loadBoardSafe()
      const ms = Date.now() - t0
      expect(board).not.toBeNull()
      console.log('[smoke] path:', marketDbPath())
      console.log(
        '[smoke] load ms:',
        ms,
        '| leaders:',
        board!.leaders.length,
        '| categories:',
        board!.categories.length
      )
      console.log(
        '[smoke] heat sizes:',
        Object.fromEntries(Object.entries(board!.periods).map(([k, v]) => [k, v.length]))
      )
      console.log('[smoke] first leader:', JSON.stringify(board!.leaders[0]))
      console.log('[smoke] b-point rows:', board!.leaders.filter((l) => l.lastBuy != null).length)
      expect(ms).toBeLessThan(30_000)
      expect(board!.leaders.length).toBeGreaterThan(50)
      expect(board!.periods.day.length).toBeGreaterThan(50)
    }
  )
})
