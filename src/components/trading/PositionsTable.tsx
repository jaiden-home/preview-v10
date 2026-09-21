'use client'

import type { Translate } from '@/lib/i18n'
import type { QuoteSnapshot } from '@/lib/chart/types'
import { fmtMoney, fmtPct, fmtSignedMoney, round2, type Position, type TradeSide } from '@/lib/trading/account'

interface PositionsTableProps {
  t: Translate
  positions: Position[]
  quotes: Record<string, QuoteSnapshot>
  onTrade: (code: string, side: TradeSide) => void
}

/** 持仓列表：现价取轮询行情（缺省回退成本价），盈亏红涨绿跌 */
export default function PositionsTable({ t, positions, quotes, onTrade }: PositionsTableProps) {
  if (positions.length === 0) {
    return <div className="trade-empty">{t('暂无持仓|No positions yet')}</div>
  }

  return (
    <div className="trade-table-wrap">
      <table className="trade-table">
        <thead>
          <tr>
            <th className="txt-left">{t('标的|Symbol')}</th>
            <th className="num">{t('持仓/可卖|Qty/Avail')}</th>
            <th className="num">{t('成本价|Cost')}</th>
            <th className="num">{t('现价|Price')}</th>
            <th className="num">{t('市值|Value')}</th>
            <th className="num">{t('浮动盈亏|P&L')}</th>
            <th className="num">{t('操作|Actions')}</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const quote = quotes[p.code]
            const price = quote?.price ?? p.costPrice
            const value = round2(price * p.qty)
            const pnl = round2((price - p.costPrice) * p.qty)
            const pnlPct = p.costPrice > 0 ? ((price - p.costPrice) / p.costPrice) * 100 : 0
            const pnlClass = pnl > 0 ? 'up' : pnl < 0 ? 'down' : 'flat'
            const priceClass =
              quote?.prevClose != null && quote.prevClose > 0
                ? price > quote.prevClose
                  ? 'up'
                  : price < quote.prevClose
                    ? 'down'
                    : 'flat'
                : 'flat'
            return (
              <tr key={p.code}>
                <td className="txt-left">
                  <div className="cell-symbol">
                    <span className="cell-name">{p.name || p.code}</span>
                    <span className="cell-code">{p.code}</span>
                  </div>
                </td>
                <td className="num">
                  {p.qty} / {p.availableQty}
                </td>
                <td className="num">{p.costPrice.toFixed(2)}</td>
                <td className={`num ${priceClass}`}>{price.toFixed(2)}</td>
                <td className="num">{fmtMoney(value)}</td>
                <td className={`num ${pnlClass}`}>
                  {fmtSignedMoney(pnl)}（{fmtPct(pnlPct)}）
                </td>
                <td className="num">
                  <div className="cell-actions">
                    <button className="trade-action-btn buy" type="button" onClick={() => onTrade(p.code, 'buy')}>
                      {t('买|Buy')}
                    </button>
                    <button
                      className="trade-action-btn sell"
                      type="button"
                      disabled={p.availableQty <= 0}
                      onClick={() => onTrade(p.code, 'sell')}
                    >
                      {t('卖|Sell')}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
