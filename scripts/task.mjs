#!/usr/bin/env node
/**
 * 任务管理脚本 —— 项目运维脚本统一入口（market.db 数据维护，口径移植自 market 项目）
 *
 * 用法：
 *   node scripts/task.mjs list                   # 列出所有任务
 *   node scripts/task.mjs run <任务ID> [参数...]   # 运行指定任务
 *   npm run task -- list
 *   npm run task -- run <任务ID>
 *
 * 分工：应用侧对 market.db 只读（src/lib/server/market-db/db.ts）；数据写入只发生在本目录任务。
 */

const TASKS = {
  'sync:kline-daily': {
    desc: '同步 日K线 → kline_daily（腾讯源；自动补漏跑交易日 + 当日实时/终值快照，任意时刻可跑，幂等；--status 查看数据完整性）',
    file: 'sync/kline-daily.mjs'
  },
  'sync:leaders': {
    desc: '计算 概念领涨事件 → leader_events（本地自算；默认增量，--from=YYYY-MM-DD 强制重算）',
    file: 'sync/leaders.mjs'
  },
  maintain: {
    desc: '统一维护：kline-daily（自动补漏+当日快照）→ leaders（增量重算）；盘中跑用实时数据，收盘后重跑得终值',
    file: 'maintain.mjs'
  }
}

main()

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)

  if (!cmd || cmd === 'list' || cmd === 'help' || cmd === '--help') {
    printList()
    return
  }

  if (cmd === 'run') {
    const id = rest[0]
    if (!id || !TASKS[id]) {
      console.error(`未知任务：${id ?? '（空）'}\n`)
      printList()
      process.exit(1)
    }
    const args = rest.slice(1)
    const mod = await import(`./${TASKS[id].file}`)
    await mod.run(args)
    return
  }

  console.error(`未知命令：${cmd}\n`)
  printList()
  process.exit(1)
}

function printList() {
  const entries = Object.entries(TASKS)
  console.log('可用任务（npm run task -- run <任务ID>）：\n')
  for (const [id, t] of entries) {
    console.log(`  ${id.padEnd(18)}${t.desc}  [${t.file}]`)
  }
  console.log('')
}
