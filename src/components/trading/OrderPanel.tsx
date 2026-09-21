'use client'

import { useEffect, useState } from 'react'
import type { Translate } from '@/lib/i18n'
import type { QuoteSnapshot } from '@/lib/chart/types'
import {
  calcFees,
  fmtMoney,
  isTradableCode,
  limitPricesOf,
  maxBuyQty,
  round2,
  type TradeSide,
  type TradingAccount
} from '@/lib/trading/account'

interface OrderPanelProps {
  t: Translate
  side: TradeSide
  onSideChange: (side: TradeSide) => void
  code: string
  quote: QuoteSnapshot | null
  account: TradingAccount
  onSubmit: (side: TradeSide, price: number, qty: number) => void
}

/** 买/卖委托面板：现价跟随、整手快捷仓位、费用预估；校验与成交在父组件完成 */
export default function OrderPanel({ t, side, onSideChange, code, quote, account, onSubmit }: OrderPanelProps) {
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  // 是否手动改过价：未改过时价格持续跟随现价
  const [priceDirty, setPriceDirty] = useState(false)

  const tradable = isTradableCode(code)
  const position = account.positions.find((p) => p.code === code)
  const livePrice = quote?.price ?? null

  // 切换标的时清空输入并恢复价格跟随
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrice('')
    setQty('')
    setPriceDirty(false)
  }, [code])

  // 未手动改价时跟随最新现价
  useEffect(() => {
    if (!priceDirty && livePrice != null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrice(livePrice.toFixed(2))
    }
  }, [livePrice, priceDirty])

  const priceNum = Number.parseFloat(price)
  const qtyNum = Number.parseInt(qty, 10)
  const valid = Number.isFinite(priceNum) && priceNum > 0 && Number.isInteger(qtyNum) && qtyNum > 0
  const amount = valid ? round2(priceNum * qtyNum) : 0
  const fee = valid ? calcFees(side, amount) : 0
  const limits = quote?.prevClose != null && quote.prevClose > 0 ? limitPricesOf(quote.prevClose, code) : null

  const change =
    quote != null && livePrice != null && quote.prevClose != null && quote.prevClose > 0
      ? { abs: round2(livePrice - quote.prevClose), pct: ((livePrice - quote.prevClose) / quote.prevClose) * 100 }
      : null
  const priceClass = change == null || change.abs === 0 ? 'flat' : change.abs > 0 ? 'up' : 'down'

  const buyMax = livePrice != null ? maxBuyQty(account.cash, livePrice) : 0
  const availableQty = position?.availableQty ?? 0

  const applyQuickBuy = (pct: number) => {
    if (livePrice == null) {
      return
    }
    const target = Math.floor((buyMax * pct) / 100 / 100) * 100
    setQty(target > 0 ? `${target}` : '')
  }
  const applyQuickSell = (pct: number) => {
    if (pct >= 100) {
      setQty(availableQty > 0 ? `${availableQty}` : '')
      return
    }
    const target = Math.floor((availableQty * pct) / 100 / 100) * 100
    setQty(target > 0 ? `${target}` : '')
  }

  const handleSubmit = () => {
    if (!valid) {
      return
    }
    onSubmit(side, round2(priceNum), qtyNum)
  }

  return (
    <section className="trade-card order-panel">
      <header className="order-head">
        <div className="order-title">
          <span className="order-name">{quote?.name ?? code}</span>
          <span className="order-code">{code}</span>
        </div>
        {livePrice != null && (
          <div className="order-quote">
            <span className={`order-price ${priceClass}`}>{livePrice.toFixed(2)}</span>
            {change != null && (
              <span className={`order-change ${priceClass}`}>
                {change.abs > 0 ? '+' : ''}
                {change.abs.toFixed(2)} ({change.pct > 0 ? '+' : ''}
                {change.pct.toFixed(2)}%)
              </span>
            )}
          </div>
        )}
      </header>

      <div className="side-tabs" role="tablist">
        <button
          className={`side-btn buy${side === 'buy' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={side === 'buy'}
          onClick={() => onSideChange('buy')}
        >
          {t('买入|Buy')}
        </button>
        <button
          className={`side-btn sell${side === 'sell' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={side === 'sell'}
          onClick={() => onSideChange('sell')}
        >
          {t('卖出|Sell')}
        </button>
      </div>

      {tradable ? (
        <>
          <div className="order-avail">
            {side === 'buy'
              ? `${t('可用资金|Available cash')} ${fmtMoney(account.cash)}`
              : `${t('可卖数量|Available to sell')} ${availableQty} / ${position?.qty ?? 0} ${t('股|shares')}`}
          </div>

          <label className="order-field">
            <span className="order-field-label">
              <span>{t('委托价格|Price')}</span>
              {limits != null && (
                <span className="order-hint">
                  {t('涨停|Limit up')} {limits.upper.toFixed(2)} · {t('跌停|Limit down')} {limits.lower.toFixed(2)}
                </span>
              )}
            </span>
            <input
              className="order-input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              placeholder={livePrice != null ? livePrice.toFixed(2) : '0.00'}
              value={price}
              disabled={livePrice == null}
              onChange={(event) => {
                setPriceDirty(true)
                setPrice(event.target.value)
              }}
            />
          </label>

          <label className="order-field">
            <span className="order-field-label">
              <span>
                {t('委托数量|Quantity')}（{t('股|shares')}）
              </span>
              {side === 'buy' && buyMax > 0 && (
                <span className="order-hint">
                  {t('最大可买|Max buy')} {buyMax} {t('股|shares')}
                </span>
              )}
            </span>
            <input
              className="order-input"
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              placeholder="0"
              value={qty}
              disabled={livePrice == null}
              onChange={(event) => setQty(event.target.value)}
            />
          </label>

          <div className="quick-row">
            {side === 'buy' ? (
              <>
                <button className="quick-btn" type="button" onClick={() => applyQuickBuy(25)}>
                  25%
                </button>
                <button className="quick-btn" type="button" onClick={() => applyQuickBuy(50)}>
                  50%
                </button>
                <button className="quick-btn" type="button" onClick={() => applyQuickBuy(75)}>
                  75%
                </button>
                <button className="quick-btn" type="button" onClick={() => setQty(buyMax > 0 ? `${buyMax}` : '')}>
                  {t('全仓|Max')}
                </button>
              </>
            ) : (
              <>
                <button className="quick-btn" type="button" onClick={() => applyQuickSell(50)}>
                  {t('半仓|Half')}
                </button>
                <button className="quick-btn" type="button" onClick={() => applyQuickSell(100)}>
                  {t('全部|All')}
                </button>
              </>
            )}
          </div>

          <div className="order-estimate">
            <div className="order-estimate-row">
              <span className="order-estimate-label">{t('委托金额|Order amount')}</span>
              <span>{valid ? fmtMoney(amount) : '--'}</span>
            </div>
            <div className="order-estimate-row">
              <span className="order-estimate-label">{t('预估费用|Est. fee')}</span>
              <span>{valid ? fmtMoney(fee) : '--'}</span>
            </div>
            <div className="order-estimate-row">
              <span className="order-estimate-label">
                {side === 'buy' ? t('所需金额|Total needed') : t('预计获得|Net proceeds')}
              </span>
              <span>{valid ? fmtMoney(side === 'buy' ? round2(amount + fee) : round2(amount - fee)) : '--'}</span>
            </div>
          </div>

          <button className={`order-submit ${side}`} type="button" disabled={!valid} onClick={handleSubmit}>
            {side === 'buy' ? t('买入|Buy') : t('卖出|Sell')} {code.slice(2)}
          </button>
        </>
      ) : (
        <div className="order-untradable">
          <p>
            {t(
              '指数与该类标的暂不支持模拟交易，请选择 A 股个股。|Indexes are not tradable here. Please pick an A-share stock.'
            )}
          </p>
        </div>
      )}
    </section>
  )
}
