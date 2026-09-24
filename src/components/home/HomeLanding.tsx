'use client'

import Link from 'next/link'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useLocale } from '@/components/terminal/useLocale'

/** 首页入口页：行情看板与模拟交易两张入口卡片；无图表，主题切换独立实现（与 useChartTerminal 同款 #app.dark 驱动） */
export default function HomeLanding() {
  const { t } = useLocale()

  // 每次从 DOM 取反（而非本地 state）：客户端导航往返后主题类随根节点保留，state 会失真（首击无效）
  const toggleTheme = () => {
    const root = document.getElementById('app')
    const next = !root?.classList.contains('dark')
    // 切换瞬间抑制 CSS 过渡：避免元素对变量换值做 0.2s 补间（与 useChartTerminal 一致）
    root?.classList.add('theme-switching')
    root?.classList.toggle('dark', next)
    window.setTimeout(() => root?.classList.remove('theme-switching'), 50)
  }

  return (
    <div className="home-page">
      <div className="toolbar">
        <div className="toolbar-item">
          <span className="home-brand">KLineChart</span>
        </div>
        <ThemeToggle t={t} onToggle={toggleTheme} />
      </div>
      <div className="home-main">
        <div className="home-hero">
          <h1 className="home-hero-title">{t('A股行情与模拟交易|A-Share Charts & Paper Trading')}</h1>
          <p className="home-hero-sub">{t('选择一个入口开始|Pick an entry to get started')}</p>
        </div>
        <nav className="home-grid" aria-label={t('页面入口|Page entries')}>
          <Link className="home-card" href="/dashboard">
            <span className="home-card-head">
              <span className="home-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M6 4v2" />
                  <rect x="4" y="6" width="4" height="7" rx="1" />
                  <path d="M6 13v3" />
                  <path d="M12 6v2" />
                  <rect x="10" y="8" width="4" height="7" rx="1" />
                  <path d="M12 15v3" />
                  <path d="M18 3v3" />
                  <rect x="16" y="6" width="4" height="8" rx="1" />
                  <path d="M18 14v4" />
                </svg>
              </span>
              <span className="home-card-arrow" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </span>
            <span className="home-card-title">{t('行情看板|Market Dashboard')}</span>
            <span className="home-card-desc">
              {t(
                '分时与多周期 K 线、技术指标与基本面数据|Intraday & multi-period K-lines, indicators and fundamentals'
              )}
            </span>
          </Link>
          <Link className="home-card trade" href="/trade">
            <span className="home-card-head">
              <span className="home-card-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 20V7" />
                  <path d="M8 7l-3.5 3.5" />
                  <path d="M8 7l3.5 3.5" />
                  <path d="M16 4v13" />
                  <path d="M16 17l-3.5-3.5" />
                  <path d="M16 17l3.5-3.5" />
                </svg>
              </span>
              <span className="home-card-arrow" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </span>
            <span className="home-card-title">{t('模拟交易|Paper Trading')}</span>
            <span className="home-card-desc">
              {t('虚拟资金整手交易，T+1、涨跌停与费用仿真|Virtual account with T+1, price limits and fee simulation')}
            </span>
          </Link>
        </nav>
      </div>
    </div>
  )
}
