import { NextResponse } from 'next/server'
import { getEnv } from './env'
import { SlidingWindowRateLimiter, clientKeyFrom } from './rate-limit'

/** JSON 成功响应：行情数据由服务端 TTL 缓存管理，禁用 HTTP 层缓存避免陈旧价格 */
export const jsonOk = <T>(data: T): NextResponse =>
  NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })

export const jsonError = (status: number, code: string, message: string): NextResponse =>
  NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })

/** 进程级共享限流器（按 IP 滑动窗口） */
const apiLimiter = new SlidingWindowRateLimiter(getEnv().RATE_LIMIT_PER_MINUTE, 60_000)

/** 模拟交易口独立限流器（/api/sim 轮询密集，不挤占聚合口配额） */
const simLimiter = new SlidingWindowRateLimiter(getEnv().RATE_LIMIT_SIM_PER_MINUTE, 60_000)

export const allowRequest = (request: Request): boolean => {
  const allowed = apiLimiter.check(clientKeyFrom(request))
  if (allowed) {
    apiLimiter.sweep()
  }
  return allowed
}

export const allowSimRequest = (request: Request): boolean => {
  const allowed = simLimiter.check(clientKeyFrom(request))
  if (allowed) {
    simLimiter.sweep()
  }
  return allowed
}

/** 从中间件注入的 x-request-id 取请求标识 */
export const requestIdOf = (request: Request): string | null => request.headers.get('x-request-id')

/** 将 searchParams 转为普通对象供 zod 校验 */
export const queryObject = (request: Request): Record<string, string> => {
  const url = new URL(request.url)
  return Object.fromEntries(url.searchParams.entries())
}
