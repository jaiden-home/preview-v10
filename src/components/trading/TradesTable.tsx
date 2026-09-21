'use client'

import type { Translate } from '@/lib/i18n'
import { fmtMoney, fmtSignedMoney, type TradeRecord } from '@/lib/trading/account'

interface TradesTableProps {
  t: Translate
  trades: TradeRecord[]
  locale: 'zh-CN' | 'en-US'
}

const formatTs = (ts: number, locale: 'zh-CN' | 'en-US'): string =>
  new Date(ts).toLocaleString(locale === 'en-US' ? 'en-US' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })

/** 成交记录（新成交在前） */
export default function TradesTable({ t, trades, locale }: TradesTableProps) {
  if (trades.length === 0) {
    return <div className="trade-empty">{t('暂无成交记录|No trades yet')}</div>
  }

  return (
    <div className="trade-table-wrap">
      <table className="trade-table">
        <thead>
          <tr>
            <th className="txt-left">{t('时间|Time')}</th>
            <th className="txt-left">{t('标的|Symbol')}</th>
            <th className="txt-left">{t('方向|Side')}</th>
            <th className="num">{t('价格|Price')}</th>
            <th className="num">{t('数量|Qty')}</th>
            <th className="num">{t('金额|Amount')}</th>
            <th className="num">{t('费用|Fee')}</th>
            <th className="num">{t('已实现盈亏|Realized P&L')}</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id}>
              <td className="txt-left">{formatTs(trade.ts, locale)}</td>
              <td className="txt-left">
                <div className="cell-symbol">
                  <span className="cell-name">{trade.name || trade.code}</span>
                  <span className="cell-code">{trade.code}</span>
                </div>
              </td>
              <td className={`txt-left ${trade.side === 'buy' ? 'up' : 'down'}`}>
                {trade.side === 'buy' ? t('买入|Buy') : t('卖出|Sell')}
              </td>
              <td className="num">{trade.price.toFixed(2)}</td>
              <td className="num">{trade.qty}</td>
              <td className="num">{fmtMoney(trade.amount)}</td>
              <td className="num">{fmtMoney(trade.fee)}</td>
              <td
                className={`num ${trade.realizedPnl == null ? 'flat' : trade.realizedPnl > 0 ? 'up' : trade.realizedPnl < 0 ? 'down' : 'flat'}`}
              >
                {trade.realizedPnl == null ? '--' : fmtSignedMoney(trade.realizedPnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
