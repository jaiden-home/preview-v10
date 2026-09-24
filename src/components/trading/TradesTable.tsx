'use client'

import type { Translate } from '@/lib/i18n'
import { fmtMoney, fmtSignedMoney, type TradeRecord } from '@/lib/trading/account'

interface TradesTableProps {
  t: Translate
  trades: TradeRecord[]
  locale: 'zh-CN' | 'en-US'
}

const formatTs = (ts: number, locale: 'zh-CN' | 'en-US'): string =>
  new Date(ts).toLocaleDateString(locale === 'en-US' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

/** 成交记录（新成交在前）；桌面为宽表，移动端为回执票据式信息卡（.trade-list，§3.11） */
export default function TradesTable({ t, trades, locale }: TradesTableProps) {
  if (trades.length === 0) {
    return (
      <div className="trade-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path
            d="M8 5V3m8 2V3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 8h2m4 0h2m-8 3.5h2m4 0h2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="trade-empty-title">{t('暂无成交记录|No trades yet')}</span>
        <span className="trade-empty-sub">{t('委托成交后将显示在这里|Trades will appear here after filling')}</span>
      </div>
    )
  }

  return (
    <>
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
                <td className={`txt-left ${trade.side === 'buy' ? 'up' : 'accent'}`}>
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
      {/* 移动端（§3.11）：回执票据式信息卡——双锚点头（方向戳记+名称/代码 | 已实现盈亏大数+日期）+ 淡底统计带，桌面经 CSS 隐藏 */}
      <div className="trade-list">
        {trades.map((trade) => (
          <div className="list-item" key={trade.id}>
            <div className="list-head">
              <div className="list-id">
                <span className="cell-name">
                  <span className={`list-side ${trade.side === 'buy' ? 'up' : 'accent'}`}>
                    {trade.side === 'buy' ? t('买入|Buy') : t('卖出|Sell')}
                  </span>
                  {trade.name || trade.code}
                </span>
                <span className="cell-code">{trade.code}</span>
              </div>
              <div className="list-hero">
                <span
                  className={`list-hero-value ${trade.realizedPnl == null ? 'flat' : trade.realizedPnl > 0 ? 'up' : trade.realizedPnl < 0 ? 'down' : 'flat'}`}
                >
                  {trade.realizedPnl == null ? '--' : fmtSignedMoney(trade.realizedPnl)}
                </span>
                <span className="list-hero-sub num">{formatTs(trade.ts, locale)}</span>
              </div>
            </div>
            <div className="list-stats">
              <div className="list-stat">
                <span className="list-stat-label">{t('价格|Price')}</span>
                <span className="num list-stat-value">{trade.price.toFixed(2)}</span>
              </div>
              <div className="list-stat">
                <span className="list-stat-label">{t('数量|Qty')}</span>
                <span className="num list-stat-value">{trade.qty}</span>
              </div>
              <div className="list-stat">
                <span className="list-stat-label">{t('金额|Amount')}</span>
                <span className="num list-stat-value">{fmtMoney(trade.amount)}</span>
              </div>
              <div className="list-stat">
                <span className="list-stat-label">{t('费用|Fee')}</span>
                <span className="num list-stat-value">{fmtMoney(trade.fee)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
