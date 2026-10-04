// ==================== 自选收藏存取（客户端，行情中心 / 量化选股共用） ====================

export interface WatchItem {
  market: string
  ticker: string
  name: string
}

export const WATCHLIST_KEY = 'klinecharts-market-watchlist'

export const loadWatchlist = (): WatchItem[] => {
  try {
    const raw = window.localStorage.getItem(WATCHLIST_KEY)
    const parsed: unknown = raw == null ? null : JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (item): item is WatchItem =>
        typeof item === 'object' &&
        item != null &&
        typeof (item as WatchItem).market === 'string' &&
        typeof (item as WatchItem).ticker === 'string' &&
        typeof (item as WatchItem).name === 'string'
    )
  } catch {
    return []
  }
}

export const persistWatchlist = (items: WatchItem[]): void => {
  window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items))
}

/** 切换自选（在则移除、无则追加），返回新列表（调用方负责 setState） */
export const toggleWatchItem = (
  items: WatchItem[],
  item: { market: string; ticker: string; name: string }
): WatchItem[] => {
  const code = `${item.market}${item.ticker}`
  return items.some((watch) => `${watch.market}${watch.ticker}` === code)
    ? items.filter((watch) => `${watch.market}${watch.ticker}` !== code)
    : [...items, { market: item.market, ticker: item.ticker, name: item.name }]
}
