import { describe, expect, it } from 'vitest'
import { cnPeriodKey } from './constants'
import {
  aggregateBars,
  guessCnMarket,
  isCnIndex,
  isCnStarMarket,
  localDayKey,
  parseCnBarTime,
  pickPrevClose
} from './utils'
import type { KLineData } from 'klinecharts'

describe('A股数据源纯函数', () => {
  it('parseCnBarTime 支持三种时间格式并拒绝非法值', () => {
    expect(parseCnBarTime('2026-09-14')).toBe(new Date('2026-09-14T00:00:00').getTime())
    expect(parseCnBarTime('2026-09-14 14:45')).toBe(new Date('2026-09-14T14:45').getTime())
    expect(parseCnBarTime('202609141445')).toBe(new Date('2026-09-14T14:45').getTime())
    expect(parseCnBarTime('20260914')).toBe(new Date('2026-09-14T00:00:00').getTime())
    expect(Number.isNaN(parseCnBarTime('abc'))).toBe(true)
  })

  it('aggregateBars 按毫秒桶合并 OHLCV 且时间对齐桶起点', () => {
    const hour = 60 * 60 * 1000
    const bucketStart = Math.ceil(new Date('2026-09-14T09:00:00').getTime() / (2 * hour)) * (2 * hour)
    const dataList = [
      { timestamp: bucketStart + 15 * 60000, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { timestamp: bucketStart + 45 * 60000, open: 11, high: 15, low: 10, close: 14, volume: 200 },
      { timestamp: bucketStart + hour + 10 * 60000, open: 14, high: 16, low: 13, close: 15, volume: 300 }
    ]
    const result = aggregateBars(dataList, 2 * hour)
    expect(result).toHaveLength(1)
    expect(result[0].timestamp).toBe(bucketStart)
    expect(result[0].open).toBe(10)
    expect(result[0].high).toBe(16)
    expect(result[0].low).toBe(9)
    expect(result[0].close).toBe(15)
    expect(result[0].volume).toBe(600)
  })

  it('guessCnMarket 按代码前缀推断市场', () => {
    expect(guessCnMarket('600519')).toBe('sh')
    expect(guessCnMarket('688981')).toBe('sh')
    expect(guessCnMarket('000001')).toBe('sz')
    expect(guessCnMarket('300750')).toBe('sz')
    expect(guessCnMarket('002594')).toBe('sz')
    expect(guessCnMarket('430047')).toBe('bj')
    expect(guessCnMarket('832566')).toBe('bj')
    expect(guessCnMarket('920001')).toBe('bj')
  })

  it('cnPeriodKey 生成周期键且非标准周期返回未映射键', () => {
    expect(cnPeriodKey({ span: 15, type: 'minute' })).toBe('15m')
    expect(cnPeriodKey({ span: 1, type: 'hour' })).toBe('1h')
    expect(cnPeriodKey({ span: 1, type: 'day' })).toBe('1d')
    expect(cnPeriodKey({ span: 4, type: 'hour' })).toBe('4h')
  })

  it('localDayKey 使用本地日期生成分组键', () => {
    expect(localDayKey(new Date('2026-09-14T23:59').getTime())).toBe('2026-9-14')
    expect(localDayKey(new Date('2026-01-02T00:00').getTime())).toBe('2026-1-2')
  })

  it('isCnStarMarket 仅识别沪市科创板代码', () => {
    expect(isCnStarMarket({ market: 'sh', ticker: '688981' })).toBe(true)
    expect(isCnStarMarket({ market: 'sh', ticker: '689009' })).toBe(true)
    expect(isCnStarMarket({ market: 'sh', ticker: '600519' })).toBe(false)
    expect(isCnStarMarket({ market: 'sz', ticker: '300750' })).toBe(false)
    expect(isCnStarMarket({ market: 'sz', ticker: '688981' })).toBe(false)
    expect(isCnStarMarket({ market: 'bj', ticker: '920001' })).toBe(false)
  })

  it('isCnIndex 按市场前缀识别沪深北指数，区分同名个股', () => {
    expect(isCnIndex({ market: 'sh', ticker: '000001' })).toBe(true)
    expect(isCnIndex({ market: 'sh', ticker: '000300' })).toBe(true)
    expect(isCnIndex({ market: 'sh', ticker: '000688' })).toBe(true)
    expect(isCnIndex({ market: 'sz', ticker: '399001' })).toBe(true)
    expect(isCnIndex({ market: 'sz', ticker: '399006' })).toBe(true)
    expect(isCnIndex({ market: 'bj', ticker: '899050' })).toBe(true)
    expect(isCnIndex({ market: 'sz', ticker: '000001' })).toBe(false)
    expect(isCnIndex({ market: 'sh', ticker: '600519' })).toBe(false)
    expect(isCnIndex({ market: 'sz', ticker: '300750' })).toBe(false)
    expect(isCnIndex({ market: 'sh', ticker: '688981' })).toBe(false)
  })

  it('pickPrevClose 选取展示日前一交易日收盘价并处理边界', () => {
    const bar = (ts: number, close: number): KLineData => ({
      timestamp: ts,
      open: close - 1,
      close,
      high: close,
      low: close - 1,
      volume: 1
    })
    const d11 = bar(new Date('2026-09-11T00:00').getTime(), 10)
    const d14 = bar(new Date('2026-09-14T00:00').getTime(), 11)
    const d15 = bar(new Date('2026-09-15T00:00').getTime(), 12)
    expect(pickPrevClose([d11, d14, d15], localDayKey(d14.timestamp), 99)).toBe(10)
    expect(pickPrevClose([d11, d14], localDayKey(d15.timestamp), 99)).toBe(11)
    expect(pickPrevClose([d14, d15], localDayKey(d14.timestamp), 99)).toBe(10)
    expect(pickPrevClose([], '2026-9-14', 88)).toBe(88)
  })
})
