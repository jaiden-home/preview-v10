'use client'

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SYMBOLS } from '@/lib/chart/constants'
import { fetchSymbolSearch } from '@/lib/chart/api'
import type { SymbolSearchItem } from '@/lib/chart/types'
import type { Translate } from '@/lib/i18n'
import { useDismiss } from './useDismiss'

interface SymbolPickerProps {
  label: string
  t: Translate
  onSelect: (item: SymbolSearchItem) => void
}

/** 标的选择：下拉搜索（6 位代码精确匹配 + 名称/拼音联想，联想由服务端 smartbox 提供） */
export default function SymbolPicker({ label, t, onSelect }: SymbolPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // 搜索结果与发起搜索的关键词绑定，避免输入变化时展示过期结果
  const [search, setSearch] = useState<{ q: string; items: SymbolSearchItem[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useDismiss(open, () => setOpen(false))

  const q = query.trim()
  const items = q === '' ? DEFAULT_SYMBOLS : search?.q === q ? search.items : []

  // 300ms 防抖搜索（与原 SPA 一致）；空查询展示默认标的
  useEffect(() => {
    if (q === '') {
      return
    }
    const timer = setTimeout(() => {
      void fetchSymbolSearch(q).then((items) => setSearch({ q, items }))
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  return (
    <div className="toolbar-item" ref={wrapRef}>
      <button className="tb-btn tb-symbol" id="symbol-btn" type="button" onClick={() => setOpen((prev) => !prev)}>
        {label}
      </button>
      <div className={`dropdown symbol-dropdown${open ? ' open' : ''}`} id="symbol-dropdown">
        <div className="search-box">
          <input
            ref={inputRef}
            className="symbol-search-input"
            id="symbol-search-input"
            placeholder={t('搜索代码或名称|Search code or name')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className={`search-clear-btn${query !== '' ? ' visible' : ''}`}
            id="search-clear-btn"
            type="button"
            title={t('清空|Clear')}
            onClick={(event) => {
              event.stopPropagation()
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            ×
          </button>
        </div>
        <div className="symbol-list" id="symbol-list">
          {items.length === 0 && <div className="symbol-empty">{t('无结果|No results')}</div>}
          {items.map((item) => (
            <div
              key={`${item.market}${item.ticker}`}
              className="symbol-row"
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelect(item)
                setOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  onSelect(item)
                  setOpen(false)
                }
              }}
            >
              <span className="symbol-ticker">{item.ticker}</span>
              <span className="symbol-name">{item.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
