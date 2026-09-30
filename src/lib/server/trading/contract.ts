import type { SimErrorCode, SimOrderInput, SimOrderResult, SimSessionAction, SimState } from '@/lib/trading/protocol'

// ==================== 模拟交易服务契约（BFF 路由唯一依赖，生产模块图——禁止引入 vitest） ====================
// 切换真实交易接口 = 新增平级实现目录（如 remote/）+ registry 登记 + SIM_TRADING_PROVIDER 指向它，
// 路由与前端零改动；新实现上线门槛 = 实现 SimTradingProvider + 通过契约测试套件（contract.test.ts）。

/** 会话控制等编排失败的领域错误（route 层捕获转 4xx JSON） */
export class SimTradingError extends Error {
  constructor(
    readonly simCode: SimErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SimTradingError'
  }
}

export interface SimTradingProvider {
  /** 实现标识（registry 登记的 id） */
  id: string
  capabilities: {
    /** 是否支持历史回放会话（真实交易接口无虚拟时钟，simtrade 回放模式据此降级） */
    replaySession: boolean
  }
  /** 账户 + 会话快照（内部先按服务端时钟结算再返回；有会话附带回放视图） */
  getState(sid: string): Promise<SimState>
  /** 下单（服务端权威校验与成交；虚拟成交时间由服务端会话推导） */
  placeOrder(sid: string, order: SimOrderInput): Promise<SimOrderResult>
  /** 会话控制（start/pause/resume/restart） */
  controlSession(sid: string, action: SimSessionAction): Promise<SimState>
}
