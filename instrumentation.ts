/**
 * Next.js 服务端插桩：按运行时分发。
 * process.env.NEXT_RUNTIME 会被构建期静态替换，Edge bundle 中
 * node 分支被摇树移除，避免 Node API 进入 Edge 编译。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
