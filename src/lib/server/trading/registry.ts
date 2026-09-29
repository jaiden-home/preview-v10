import { getEnv } from '../env'
import type { SimTradingProvider } from './contract'
import { createLocalTradingProvider } from './local/provider'

/** 模拟交易服务注册表：切换实现 = 新增 provider 目录 + 在此登记 + SIM_TRADING_PROVIDER 指向它 */
const FACTORIES: Record<string, () => SimTradingProvider> = {
  local: createLocalTradingProvider
}

let instance: SimTradingProvider | undefined

/** 当前模拟交易服务实例（进程内单例；SIM_TRADING_PROVIDER 非法值在首次访问时快速失败） */
export const getTradingProvider = (): SimTradingProvider => {
  if (instance != null) {
    return instance
  }
  const id = getEnv().SIM_TRADING_PROVIDER
  const factory = FACTORIES[id]
  if (factory == null) {
    throw new Error(`unknown SIM_TRADING_PROVIDER "${id}", available: ${Object.keys(FACTORIES).join(', ')}`)
  }
  instance = factory()
  return instance
}
