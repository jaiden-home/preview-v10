import pino from 'pino'
import { getEnv } from './env'

/** 全局结构化日志（Next.js 服务端运行时） */
export const logger = pino({
  level: getEnv().LOG_LEVEL,
  base: { service: 'klinecharts-preview' },
  formatters: {
    level: (label) => ({ level: label })
  }
})

/** 为单个请求派生带 requestId 的子 logger */
export const requestLogger = (requestId?: string | null) => logger.child({ requestId: requestId ?? 'n/a' })
