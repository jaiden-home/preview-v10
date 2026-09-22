import { getEnv } from '../env'
import { createTencentProvider } from './tencent'
import type { MarketDataProvider } from './types'

/** 数据源注册表：切换服务商 = 新增 provider 目录 + 在此登记 + DATA_PROVIDER 指向它 */
const FACTORIES: Record<string, () => MarketDataProvider> = {
  tencent: createTencentProvider
}

let instance: MarketDataProvider | undefined

/** 当前数据源实例（进程内单例；DATA_PROVIDER 非法值在首次访问时快速失败） */
export const getProvider = (): MarketDataProvider => {
  if (instance != null) {
    return instance
  }
  const id = getEnv().DATA_PROVIDER
  const factory = FACTORIES[id]
  if (factory == null) {
    throw new Error(`unknown DATA_PROVIDER "${id}", available: ${Object.keys(FACTORIES).join(', ')}`)
  }
  instance = factory()
  return instance
}
