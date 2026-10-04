// ==================== 交易消息目录（code → 双语文案单一来源） ====================
// 全部交易域用户可见文案（下单校验拒单 / 会话与行情拒单 / 客户端兜底与回执）收敛于此，
// rules.ts / events.ts（经 validateOrder）、lib/server/trading/engine.ts（SimTradingError）
// 与交易页组件共用——同一语义只写一份，服务端与客户端预检口径天然一致。
// 文案为 '中文|English' 内联双语串，展示端经 t() 按 locale 切半；
// 值插值用 {key} 占位符，经 msg() 填充（调用方负责格式化，如 toFixed(2)）。

/** 下单校验（rules.ts OrderRejection，客户端 /trade 与服务端 /simtrade 共用管线） */
export const TRADE_MESSAGES = {
  // —— 下单校验拒单（code 与 OrderRejectCode 对应）——
  not_tradable: '指数与该类标的暂不支持模拟交易|Indexes are not tradable in paper trading',
  invalid_price: '请输入有效价格|Invalid price',
  price_limit: '超出涨跌停范围（{lower} ~ {upper}）|Out of price limit range ({lower} ~ {upper})',
  price_unfillable_buy: '委托价低于现价 {px}，不能成交|Order price is below market {px}; cannot fill',
  price_unfillable_sell: '委托价高于现价 {px}，不能成交|Order price is above market {px}; cannot fill',
  invalid_qty: '请输入有效数量|Invalid quantity',
  lot_size: '买入数量须为 100 股的整数倍|Buy quantity must be in multiples of 100',
  insufficient_cash: '可用资金不足|Insufficient cash',
  insufficient_qty: '可卖数量不足（当日买入 T+1 可卖）|Insufficient available quantity (T+1 rule)',
  // —— 会话 / 行情拒单（engine.ts SimTradingError 与组件预检共用，口径唯一）——
  no_active_session: '正在开局，请稍候|Session is starting, please wait',
  session_ended: '本局已结束，请等待新的开局|Session ended; please wait for a new round',
  session_paused: '已暂停，请等待新的开局后再下单|Paused; please wait for a new round before trading',
  quote_unavailable: '行情加载中，请稍候|Quotes loading, please wait',
  insufficient_history: '回放数据不足，无法开始模拟|Insufficient replay data to start',
  insufficient_days: '交易日不足，请调整起始/结束日期|Not enough trading days; adjust the dates',
  // —— 客户端兜底 / 回执（跨页共用）——
  network_error: '网络异常，请稍候重试|Network error, please retry',
  start_failed: '开局失败，请稍候重试|Failed to start, please retry',
  account_reset: '账户已重置|Account reset',
  order_filled_buy: '买入 {code} {qty}股 @ {price} 已成交|Buy {code} {qty}shares @ {price} filled',
  order_filled_sell: '卖出 {code} {qty}股 @ {price} 已成交|Sell {code} {qty}shares @ {price} filled'
} as const

export type TradeMessageKey = keyof typeof TRADE_MESSAGES

/** 取文案；带 {key} 占位符的模板须传 params 填充（值为字符串/数字） */
export const msg = (key: TradeMessageKey, params?: Record<string, string | number>): string => {
  let text: string = TRADE_MESSAGES[key]
  if (params != null) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, `${value}`)
    }
  }
  return text
}
