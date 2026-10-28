'use client'

import Link from 'next/link'
import ThemeToggle from '@/components/terminal/ThemeToggle'
import { useLocale } from '@/components/terminal/useLocale'

/** 首页入口页：行情看板 / 模拟交易 / 极速模拟三张入口卡片；无图表，主题切换独立实现（与 useChartTerminal 同款 #app.dark 驱动） */
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
      <div className="home-main">
        <div className="toolbar">
          <div className="toolbar-item">
            <span className="home-brand">KLineChart</span>
          </div>
          <ThemeToggle t={t} onToggle={toggleTheme} />
        </div>
        <div className="home-hero">
          <h1 className="home-hero-title">{t('A股行情与模拟交易|A-Share Charts & Paper Trading')}</h1>
          <p className="home-hero-sub">{t('选择一个入口开始|Pick an entry to get started')}</p>
        </div>
        <nav className="home-grid" aria-label={t('页面入口|Page entries')}>
          {/* 行情中心入口：板块榜单 + 自选，品牌蓝语义（§3.15） */}
          <Link className="home-card market" href="/market">
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
                  <path d="M4 6h9" />
                  <path d="M4 12h6" />
                  <path d="M4 18h11" />
                  <path d="M17.5 4.5l1.1 2.2 2.4.35-1.75 1.7.4 2.4-2.15-1.1-2.15 1.1.4-2.4-1.75-1.7 2.4-.35z" />
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
            <span className="home-card-title">{t('行情中心|Market Center')}</span>
            <span className="home-card-desc">
              {t('指数概览、板块榜单与自选收藏|Index overview, board rankings and watchlist')}
            </span>
          </Link>
          {/* 选股中心入口：领涨看板，品牌蓝语义（§3.16） */}
          <Link className="home-card screener" href="/screener">
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
                  <path d="M4 5v14" />
                  <path d="M4 15l4.5-4.5 3 3L20 5" />
                  <circle cx="20" cy="9.5" r="2.2" />
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
            <span className="home-card-title">{t('选股中心|Screener Center')}</span>
            <span className="home-card-desc">{t('概念热力与趋势领涨看板|Concept heatmap and trend leader board')}</span>
          </Link>
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
          {/* 极速模拟（加速回放）入口：品牌蓝语义 */}
          <Link className="home-card sim" href="/simtrade">
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
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.5V12l3 2" />
                  <path d="M17.5 4.5l2 1.5-2 1.5" />
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
            <span className="home-card-title">{t('极速模拟|Sim Trading')}</span>
            <span className="home-card-desc">
              {t('历史 K 线回放，30 秒一个交易日|Replay history, one trading day in 30 seconds')}
            </span>
          </Link>
          {/* 模拟设置（admin）入口：品牌蓝语义（§3.14） */}
          <Link className="home-card settings" href="/admin/simtrade">
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
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
            <span className="home-card-title">{t('模拟设置|Simulation Settings')}</span>
            <span className="home-card-desc">
              {t('模拟标的、区间、倍速、开始暂停与重置|Symbol, date range, speed, run and reset control')}
            </span>
          </Link>
          {/* 概念管理（admin）入口：品牌蓝语义（§3.17） */}
          <Link className="home-card concepts" href="/admin/concepts">
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
                  <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7.6-7.6A2 2 0 0 1 2.4 11.6L3 4.6a2 2 0 0 1 1.6-1.6l7-.6a2 2 0 0 1 1.5.6l7.5 7.5a2 2 0 0 1 0 2.9z" />
                  <circle cx="7.5" cy="7.5" r="1.6" />
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
            <span className="home-card-title">{t('概念管理|Concept Admin')}</span>
            <span className="home-card-desc">
              {t('概念与大类维护、成分股划转|Manage concepts, categories and members')}
            </span>
          </Link>
        </nav>
      </div>
    </div>
  )
}
