import { describe, expect, it } from 'vitest'
import { parseQtQuote } from '../fundamental'
import { parseSmartboxResponse } from './tencent'

/** 构造腾讯 qt 行情文本：字段索引与线上接口一致 */
const buildQtText = (code: string, fields: Record<number, string>): string => {
  const array = new Array(60).fill('')
  for (const [index, value] of Object.entries(fields)) {
    array[Number(index)] = value
  }
  return `v_${code}="${array.join('~')}";`
}

describe('parseQtQuote', () => {
  const code = 'sh600519'

  it('解析名称、现价、昨收与基本面字段', () => {
    const text = buildQtText(code, {
      1: '贵州茅台',
      3: '1700.00',
      4: '1675.00',
      38: '0.28',
      39: '28.5',
      43: '1.67',
      44: '21,000.00',
      45: '21,500.00',
      46: '9.87',
      51: '1698.12',
      52: '27.1',
      53: '30.9'
    })
    const parsed = parseQtQuote(text, code)
    expect(parsed.invalid).toBe(false)
    expect(parsed.name).toBe('贵州茅台')
    expect(parsed.price).toBe(1700)
    expect(parsed.prevClose).toBe(1675)
    expect(parsed.fundamental).toEqual({
      turnoverRate: 0.28,
      amplitude: 1.67,
      pe: 28.5,
      peDynamic: 27.1,
      peStatic: 30.9,
      pb: 9.87,
      totalMarketCap: 21500_0000_0000,
      floatMarketCap: 21000_0000_0000,
      avgPrice: 1698.12
    })
  })

  it('缺失/占位字段返回 undefined，负市盈率保留', () => {
    const text = buildQtText(code, { 1: '某股', 3: '10.00', 4: '9.00', 39: '-5.5' })
    const parsed = parseQtQuote(text, code)
    expect(parsed.fundamental.pe).toBe(-5.5)
    expect(parsed.fundamental.pb).toBeUndefined()
    expect(parsed.fundamental.totalMarketCap).toBeUndefined()
  })

  it('代码不匹配或名称占位视为无效', () => {
    expect(parseQtQuote('v_sz000001="1~平安银行~..."', 'sh600519').invalid).toBe(true)
    const dash = buildQtText(code, { 1: '-' })
    expect(parseQtQuote(dash, code).invalid).toBe(true)
  })
})

describe('parseSmartboxResponse', () => {
  it('解析代码前置格式：["sh600519~贵州茅台~gp~sh"]', () => {
    const items = parseSmartboxResponse('v_hint=["sh600519~贵州茅台~gp~sh","sz000001~平安银行~gp~sz"]')
    expect(items).toEqual([
      { ticker: '600519', name: '贵州茅台', market: 'sh' },
      { ticker: '000001', name: '平安银行', market: 'sz' }
    ])
  })

  it('解析代码后置格式：["600519~贵州茅台~sh600519"]', () => {
    const items = parseSmartboxResponse('v_hint=["600519~贵州茅台~sh600519"]')
    expect(items).toEqual([{ ticker: '600519', name: '贵州茅台', market: 'sh' }])
  })

  it('过滤非 A 股市场与坏条目，限制返回数量', () => {
    const items = parseSmartboxResponse('v_hint=["hk00700~腾讯控股~gp~hk","sh600519~贵州茅台~gp~sh","garbage","12345"]')
    expect(items).toEqual([{ ticker: '600519', name: '贵州茅台', market: 'sh' }])
  })

  it('无法解析的文本返回空数组', () => {
    expect(parseSmartboxResponse('')).toEqual([])
    expect(parseSmartboxResponse('v_hint=[broken')).toEqual([])
  })
})
