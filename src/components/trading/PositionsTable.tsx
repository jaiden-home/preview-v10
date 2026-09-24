'use client'

import type { Translate } from '@/lib/i18n'
import type { QuoteSnapshot } from '@/lib/chart/types'
import { fmtMoney, fmtPct, fmtSignedMoney, round2, type Position } from '@/lib/trading/account'

interface PositionsTableProps {
  t: Translate
  positions: Position[]
  quotes: Record<string, QuoteSnapshot>
}

/** 持仓列表：现价取轮询行情（缺省回退成本价），盈亏红涨绿跌；
 *  桌面为宽表，移动端为三段式信息卡（.trade-list，§3.11） */
export default function PositionsTable({ t, positions, quotes }: PositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="trade-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path
            d="M3 8.5 4.5 4h15L21 8.5M3 8.5v10.5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8.5M3 8.5h18M9.5 13h5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="trade-empty-title">{t('暂无持仓|No positions yet')}</span>
        <span className="trade-empty-sub">{t('买入成交后将显示在这里|Positions will appear here after buying')}</span>
      </div>
    )
  }

  const rows = positions.map((p) => {
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
    return { p, price, value, pnl, pnlPct, pnlClass, priceClass }
  })

  return (
    <>
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
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, price, value, pnl, pnlPct, pnlClass, priceClass }) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 移动端（§3.11）：三段式信息卡——主行（名称+浮动盈亏锚点）/次行（代码+盈亏%）/固定 4 列数据格带，桌面经 CSS 隐藏 */}
      <div className="trade-list">
        {rows.map(({ p, price, value, pnl, pnlPct, pnlClass, priceClass }) => (
          <div className="list-item" key={p.code}>
            <div className="list-line-main">
              <span className="cell-name">{p.name || p.code}</span>
              <span className={`list-main-value ${pnlClass}`}>{fmtSignedMoney(pnl)}</span>
            </div>
            <div className="list-line-sub">
              <span className="cell-code">{p.code}</span>
              <span className={`num ${pnlClass}`}>{fmtPct(pnlPct)}</span>
            </div>
            <div className="list-grid">
              <div className="list-cell">
                <span className="list-cell-label">{t('持仓/可卖|Qty/Avail')}</span>
                <span className="num list-cell-value">
                  {p.qty}/{p.availableQty}
                </span>
              </div>
              <div className="list-cell">
                <span className="list-cell-label">{t('成本价|Cost')}</span>
                <span className="num list-cell-value">{p.costPrice.toFixed(2)}</span>
              </div>
              <div className="list-cell">
                <span className="list-cell-label">{t('现价|Price')}</span>
                <span className={`num list-cell-value ${priceClass}`}>{price.toFixed(2)}</span>
              </div>
              <div className="list-cell">
                <span className="list-cell-label">{t('市值|Value')}</span>
                <span className="num list-cell-value">{fmtMoney(value)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
