'use client'

import type { Translate } from '@/lib/i18n'

interface ThemeToggleProps {
  t: Translate
  onToggle: () => void
  /** 按钮元素 id（同页双位渲染时须唯一，首页默认 theme-btn） */
  id?: string
  /** 追加到 .toolbar-item 包裹层的类名（用于按断点显隐双位实例） */
  itemClassName?: string
}

/** 主题切换：太阳/月亮滑动开关，深色由 #app.dark 类驱动（CSS 变量联动） */
export default function ThemeToggle({ t, onToggle, id = 'theme-btn', itemClassName }: ThemeToggleProps) {
  return (
    <div className={itemClassName ? `toolbar-item ${itemClassName}` : 'toolbar-item'}>
      <button className="tb-btn tb-theme" id={id} type="button" title={t('切换主题|Toggle theme')} onClick={onToggle}>
        <span className="theme-switch" aria-hidden="true">
          <svg className="sw-icon sw-sun" viewBox="0 0 24 24">
            <path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z" />
          </svg>
          <svg className="sw-icon sw-moon" viewBox="0 0 24 24">
            <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" />
          </svg>
          <span className="theme-knob" />
        </span>
      </button>
    </div>
  )
}
