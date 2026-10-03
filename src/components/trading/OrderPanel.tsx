'use client'

import { useEffect, useRef, useState } from 'react'
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
import type { ReplayState } from '@/lib/trading/replay'
import { SimClockBadge, SimHeadProgress, simClockOf } from '@/components/simtrade/SimClock'

interface OrderPanelProps {
  t: Translate
  side: TradeSide
  onSideChange: (side: TradeSide) => void
  code: string
  quote: QuoteSnapshot | null
  account: TradingAccount
  onSubmit: (side: TradeSide, price: number, qty: number) => void
  /** 回放会话（仅 /simtrade 传入；缺省 = /trade 实时模式，order-head 不渲染模拟时钟） */
  simState?: ReplayState | null
  /** 距下一交易日的计时进度 0..1（暂停/结束为 0） */
  simProgress?: number
}

/**
 * 买/卖委托面板：现价跟随、整手快捷仓位、费用预估；校验与成交在父组件完成。
 * /simtrade 传入 simState/simProgress 时模拟时钟融合 order-head（UI_SPEC §3.13）：
 * 底缘基线虚线即当日计时进度（覆盖层同几何虚线自左逐点亮起），收尾 10 秒
 * 背景单次闪烁 + 标题旁圆形倒计时环徽记（弧随剩余秒数收缩），日推进即消失；
 * 移动端 order-head 隐藏，时钟宿主为交易坞条（SimTrading，同一套 SimClock 派生）。
 */
export default function OrderPanel({
  t,
  side,
  onSideChange,
  code,
  quote,
  account,
  onSubmit,
  simState = null,
  simProgress = 0
}: OrderPanelProps) {
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

  // 涨跌停与侧别上下文（最大可买 / 可卖数量）以三枚描边小格区分展示；
  // 可用资金不重复展示（摘要栅格已有）；缺行情时以 -- 占位保持布局稳定
  const limitUpText = limits == null ? '--' : limits.upper.toFixed(2)
  const limitDownText = limits == null ? '--' : limits.lower.toFixed(2)
  const availText = side === 'buy' ? `${buyMax}` : `${availableQty}/${position?.qty ?? 0}`

  // 融合时钟派生（/simtrade，与移动端交易坞条共用 SimClock）：进度点亮段 + 收尾倒计时
  const { running: simRunning, pct: simPct, remainSec, urgent } = simClockOf(simState, simProgress)

  // 快捷仓位（买卖同款 1/n 仓）：按最大可买/可卖取整手；
  // 全仓买入 = 最大可买（整手），全仓卖出 = 全部可卖（可含零股）
  const applyFraction = (frac: number) => {
    const base = side === 'buy' ? buyMax : availableQty
    if (base <= 0) {
      setQty('')
      return
    }
    const target = frac >= 1 ? base : Math.floor((base * frac) / 100) * 100
    setQty(target > 0 ? `${target}` : '')
  }

  // 切换买/卖：按账户与现价重算新侧可委托最大数量并同步到数量输入（为 0 清空）
  const switchSide = (next: TradeSide) => {
    if (next !== side) {
      onSideChange(next)
    }
    const max = next === 'buy' ? buyMax : availableQty
    setQty(max > 0 ? `${max}` : '')
  }

  // 成交后（成交记录新增）同样重算当前侧可委托最大数量；首挂不触发。
  // 依赖故意只挂 lastTradeId：读当次渲染的 side/buyMax/availableQty 快照，
  // 避免把行情/账户纳入依赖导致轮询反复重置数量输入。
  const lastTradeId = account.trades[0]?.id ?? ''
  const lastTradeIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastTradeIdRef.current == null) {
      lastTradeIdRef.current = lastTradeId
      return
    }
    if (lastTradeIdRef.current === lastTradeId) {
      return
    }
    lastTradeIdRef.current = lastTradeId
    const max = side === 'buy' ? buyMax : availableQty
    setQty(max > 0 ? `${max}` : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTradeId])

  const handleSubmit = () => {
    if (!valid) {
      return
    }
    onSubmit(side, round2(priceNum), qtyNum)
  }

  return (
    <div className="order-body">
      <header className={`order-head${urgent ? ' urgent' : ''}`}>
        <div className="order-title">
          <div className="order-title-text">
            <span className="order-name">{quote?.name ?? code}</span>
            <span className="order-code">{code}</span>
          </div>
          {/* 收尾 10 秒：随标题并排的圆形倒计时环（弧随剩余秒数收缩、环心剩余秒数，日推进/暂停即卸载消失） */}
          {urgent && <SimClockBadge t={t} remainSec={remainSec} />}
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
        {/* 融合时钟进度：与基线同几何的虚线覆盖层自左逐点亮起（宽度为数据驱动内联值，禁过渡宽高） */}
        {simRunning && <SimHeadProgress t={t} pct={simPct} />}
      </header>

      <div className={`side-tabs ${side}`} role="tablist">
        <span className="side-thumb" aria-hidden="true" />
        <button
          className={`side-btn buy${side === 'buy' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={side === 'buy'}
          onClick={() => switchSide('buy')}
        >
          {t('买入|Buy')}
        </button>
        <button
          className={`side-btn sell${side === 'sell' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={side === 'sell'}
          onClick={() => switchSide('sell')}
        >
          {t('卖出|Sell')}
        </button>
      </div>

      {tradable ? (
        <>
          <div className="order-fields">
            <label className="order-field">
              <span className="order-field-label">
                <span>{t('委托价格|Price')}</span>
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
          </div>

          <div className="quick-row">
            <button className="quick-btn" type="button" onClick={() => applyFraction(1 / 2)}>
              {t('1/2仓|1/2')}
            </button>
            <button className="quick-btn" type="button" onClick={() => applyFraction(1 / 3)}>
              {t('1/3仓|1/3')}
            </button>
            <button className="quick-btn" type="button" onClick={() => applyFraction(1 / 4)}>
              {t('1/4仓|1/4')}
            </button>
            <button className="quick-btn" type="button" onClick={() => applyFraction(1)}>
              {t('全仓|Max')}
            </button>
          </div>

          <div className="order-limits">
            <div className="limit-cell">
              <span className="limit-label">{t('涨停|Limit up')}</span>
              <span className={`limit-value${limits == null ? ' flat' : ' up'}`}>{limitUpText}</span>
            </div>
            <div className="limit-cell">
              <span className="limit-label">{t('跌停|Limit down')}</span>
              <span className={`limit-value${limits == null ? ' flat' : ' down'}`}>{limitDownText}</span>
            </div>
            <div className="limit-cell">
              <span className="limit-label">{side === 'buy' ? t('最大可买|Max buy') : t('可卖|Sellable')}</span>
              <span className="limit-value accent">{availText}</span>
            </div>
          </div>

          <div className="order-estimate">
            <div className="estimate-cell">
              <span className="estimate-label">{t('委托金额|Order amount')}</span>
              <span className="estimate-value">{valid ? fmtMoney(amount) : '--'}</span>
            </div>
            <div className="estimate-cell">
              <span className="estimate-label">{t('预估费用|Est. fee')}</span>
              <span className="estimate-value">{valid ? fmtMoney(fee) : '--'}</span>
            </div>
            <div className="estimate-cell">
              <span className="estimate-label">
                {side === 'buy' ? t('所需金额|Total needed') : t('预计获得|Net proceeds')}
              </span>
              <span className="estimate-value">
                {valid ? fmtMoney(side === 'buy' ? round2(amount + fee) : round2(amount - fee)) : '--'}
              </span>
            </div>
          </div>

          <button className={`order-submit ${side}`} type="button" disabled={!valid} onClick={handleSubmit}>
            {side === 'buy' ? t('买入|Buy') : t('卖出|Sell')}
          </button>
        </>
      ) : (
        <div className="order-untradable">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path
              d="M12 9v4m0 3.5v.5M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p>
            {t(
              '指数与该类标的暂不支持模拟交易，请选择 A 股个股。|Indexes are not tradable here. Please pick an A-share stock.'
            )}
          </p>
        </div>
      )}
    </div>
  )
}
