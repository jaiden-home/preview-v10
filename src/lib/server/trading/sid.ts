import { randomUUID } from 'node:crypto'

// ==================== 账户标识（httpOnly cookie sid） ====================
// BFF 无用户体系：首次访问签发随机 sid（各浏览器/设备各自独立模拟账户，客户端不可篡改）。
// 日后接真实接口时换成用户 token 鉴权，SQLite 表已按 sid 维度隔离，无感替换。

const SIM_SID_COOKIE = 'sim_sid'
const SID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ONE_YEAR_SECONDS = 31_536_000

export interface SimSid {
  sid: string
  /** 是否为本响应新签发（需要 Set-Cookie 下发） */
  isNew: boolean
}

/** 从请求 Cookie 读取账户 sid；缺失/非法时生成新 sid */
export const sidOf = (request: Request): SimSid => {
  const raw = request.headers.get('cookie') ?? ''
  const match = raw.match(new RegExp(`(?:^|;\\s*)${SIM_SID_COOKIE}=([^;]+)`))
  const value = match?.[1]?.trim()
  if (value != null && SID_PATTERN.test(value)) {
    return { sid: value, isNew: false }
  }
  return { sid: randomUUID(), isNew: true }
}

/** 新签发 sid 的 Set-Cookie 值（仅 /api/sim 路径可见） */
export const sidCookie = (sid: string): string =>
  `${SIM_SID_COOKIE}=${sid}; Path=/api/sim; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR_SECONDS}`
