export type Locale = 'zh-CN' | 'en-US'

export type Translate = (zhEn: string) => string

/** 双语文案键格式：「中文|English」，按 locale 取一侧 */
export const createT = (locale: Locale): Translate => {
  return (zhEn) => {
    const [zh, en] = zhEn.split('|')
    return locale === 'en-US' ? en : zh
  }
}

/** 从 URL hash 读取语言（保持与原 SPA `#en-US` 约定兼容），仅客户端调用 */
export const readLocaleFromHash = (): Locale => {
  if (typeof window === 'undefined') {
    return 'zh-CN'
  }
  return window.location.hash.endsWith('#en-US') ? 'en-US' : 'zh-CN'
}
