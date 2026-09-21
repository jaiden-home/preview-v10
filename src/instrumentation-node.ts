import { logger } from '@/lib/server/logger'

/** 仅 Node 运行时加载：启动日志 + 优雅停机信号记录 */
logger.info({ node: process.version, pid: process.pid }, 'server instrumentation registered')

const logShutdown = (signal: string) => logger.info({ signal }, 'shutdown signal received, draining connections')
process.once('SIGTERM', () => logShutdown('SIGTERM'))
process.once('SIGINT', () => logShutdown('SIGINT'))
