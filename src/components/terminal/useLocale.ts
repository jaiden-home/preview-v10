'use client'

import { useEffect, useMemo, useState } from 'react'
import { createT, readLocaleFromHash, type Locale, type Translate } from '@/lib/i18n'

/** 语言钩子：SSR 首帧固定 zh-CN（与服务器输出一致，避免水合不匹配），挂载后按 #en-US hash 校正 */
export function useLocale(): { locale: Locale; t: Translate } {
  const [locale, setLocale] = useState<Locale>('zh-CN')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocale(readLocaleFromHash())
  }, [])
  const t = useMemo(() => createT(locale), [locale])
  return { locale, t }
}
