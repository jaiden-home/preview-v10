import type { Translate } from '@/lib/i18n'
import { fmtMoney, fmtPct, fmtSignedMoney, type EquitySnapshot, type TradingAccount } from '@/lib/trading/account'

interface TradeSummaryProps {
  t: Translate
  account: TradingAccount
  equity: EquitySnapshot
  /** 重置入口（可选；/simtrade 不传——重置收敛至模拟设置页） */
  onReset?: () => void
}

/** 账户摘要（委托面板首段）：总资产 hero + 2×2 次指标栅格 + 重置入口（onReset 缺省不渲染） */
export default function TradeSummary({ t, account, equity, onReset }: TradeSummaryProps) {
  const pnlClass = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat')

  return (
    <div className="panel-summary">
      <div className="summary-hero">
        <div className="summary-head">
          <span className="stat-label">{t('总资产|Total assets')}</span>
          {onReset != null && (
            <button className="tb-btn tb-clear" type="button" onClick={onReset}>
              {t('重置账户|Reset')}
            </button>
          )}
        </div>
        <span className="summary-total">{fmtMoney(equity.totalAssets)}</span>
        <span className={`summary-pnl ${pnlClass(equity.totalPnl)}`}>
          {t('总盈亏|Total P&L')} {fmtSignedMoney(equity.totalPnl)}（{fmtPct(equity.totalPnlPct)}）
        </span>
      </div>
      <div className="summary-grid">
        <div className="stat-cell">
          <span className="stat-label">{t('当日盈亏|Day P&L')}</span>
          <span className={`stat-value ${pnlClass(equity.dayPnl)}`}>{fmtSignedMoney(equity.dayPnl)}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">{t('可用资金|Cash')}</span>
          <span className="stat-value">{fmtMoney(account.cash)}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">{t('持仓市值|Market value')}</span>
          <span className="stat-value">{fmtMoney(equity.marketValue)}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">{t('持仓盈亏|Position P&L')}</span>
          <span className={`stat-value ${pnlClass(equity.positionPnl)}`}>{fmtSignedMoney(equity.positionPnl)}</span>
        </div>
      </div>
    </div>
  )
}
