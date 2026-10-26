// maintain —— 统一维护入口：一条命令完成 kline_daily / leader_events 的同步（手动触发，幂等可重跑）
//
// 用法：npm run maintain（或 npm run task -- run maintain）
// 任意时刻可跑（不做时机限制，kline 任务内部自判市场状态并自动补漏跑交易日）：
//   交易日盘中跑 → 当日用当时实时数据（盘中快照）；
//   收盘后再跑一次 → 覆盖为当日终值（幂等，随时重跑安全）；
//   漏跑的交易日 → 逐股自动补齐终值，无需单独补数命令。
// 流程：sync:kline-daily（漏跑补数 + 当日快照/终值 + 完整性落状态）→ sync:leaders（增量重算）
// 状态：scripts/task_runs.json（kline 任务写入 final_through / phase，供完整性报告与 --status）
// 失败：某任务抛错 → 中止后续任务（重跑本命令幂等续传）
import { nowStr, loadTaskState } from './lib/db.mjs'
import { run as syncKlineDaily } from './sync/kline-daily.mjs'
import { run as syncLeaders } from './sync/leaders.mjs'

const PLAN = [
  { id: 'sync:kline-daily', run: syncKlineDaily },
  { id: 'sync:leaders', run: syncLeaders }
]

export async function run() {
  const results = []
  console.log(`◆ maintain 开始 · ${nowStr()}`)

  for (const t of PLAN) {
    console.log(`\n── 执行 ${t.id} ──`)
    const t0 = Date.now()
    try {
      await t.run()
      results.push([t.id, `完成（${((Date.now() - t0) / 1000).toFixed(0)}s）`])
    } catch (e) {
      results.push([t.id, `失败：${e.message}`])
      printSummary(results)
      console.log('  ⚠ 有任务失败，后续任务已中止；修复后重跑本命令（幂等续传）')
      process.exit(1)
    }
  }
  printSummary(results)
}

function printSummary(results) {
  console.log(`\n■ maintain 摘要（${nowStr()}）：`)
  for (const [id, info] of results) {
    console.log(`  ${id.padEnd(18)}${info}`)
  }
  // 数据完整性（kline 任务落定的状态）
  const st = loadTaskState()['sync:kline-daily']
  if (st?.final_through) {
    const today = nowStr().slice(0, 10)
    if (st.final_through >= today) {
      console.log(`  数据完整性：✓ 完整至 ${st.final_through}（今日终值已同步）`)
    } else if (st.phase === 'intraday') {
      console.log(`  数据完整性：◐ 今日为盘中快照（完整至 ${st.final_through}）——收盘后重跑 npm run maintain 更新终值`)
    } else {
      console.log(`  数据完整性：完整至 ${st.final_through}（今日尚未产生行情行）`)
    }
  }
}
