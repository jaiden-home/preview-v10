import { describe, expect, it } from 'vitest'
import { TRADE_MESSAGES, msg, type TradeMessageKey } from './messages'

describe('TRADE_MESSAGES 交易消息目录', () => {
  it('每条文案均为 中文|English 双语且两侧非空', () => {
    for (const [key, text] of Object.entries(TRADE_MESSAGES)) {
      const parts = text.split('|')
      expect(parts, key).toHaveLength(2)
      expect(parts[0]!.trim(), key).not.toBe('')
      expect(parts[1]!.trim(), key).not.toBe('')
    }
  })

  it('含 {key} 占位符的条目必须可被 msg() 填充干净', () => {
    const templates = (Object.keys(TRADE_MESSAGES) as TradeMessageKey[]).filter((key) =>
      TRADE_MESSAGES[key].includes('{')
    )
    expect(templates.length).toBeGreaterThan(0)
    for (const key of templates) {
      // 抽取占位符名并填入哨兵值
      const names = [...TRADE_MESSAGES[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
      const filled = msg(key, Object.fromEntries(names.map((name) => [name, `X${name}X`])))
      expect(filled.includes('{'), key).toBe(false)
      for (const name of names) {
        expect(filled.includes(`X${name}X`), key).toBe(true)
      }
    }
  })

  it('msg() 无参直出原文，插值替换两侧语言', () => {
    expect(msg('insufficient_cash')).toBe('可用资金不足|Insufficient cash')
    expect(msg('price_limit', { lower: '10.00', upper: '12.00' })).toBe(
      '超出涨跌停范围（10.00 ~ 12.00）|Out of price limit range (10.00 ~ 12.00)'
    )
    expect(msg('order_filled_buy', { code: 'sh600519', qty: 100, price: '18.72' })).toBe(
      '买入 sh600519 100股 @ 18.72 已成交|Buy sh600519 100shares @ 18.72 filled'
    )
  })

  it('本局结束文案唯一（服务端拒单与客户端预检共用同一来源）', () => {
    expect(msg('session_ended')).toBe('本局已结束，请等待新的开局|Session ended; please wait for a new round')
    expect(msg('session_paused')).toBe(
      '已暂停，请等待新的开局后再下单|Paused; please wait for a new round before trading'
    )
  })
})
