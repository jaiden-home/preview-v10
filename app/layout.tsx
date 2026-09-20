import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://preview.klinecharts.com'),
  title: {
    default: 'KLineChart | A股行情预览(A-Share Preview)',
    template: '%s | KLineChart'
  },
  description:
    '基于 KLineChart v10 与腾讯行情的 A 股 K 线预览(A-share chart preview)：分时、多周期 K 线、技术指标与基本面数据。',
  keywords: ['kline', 'k线', 'a股', '股票'],
  icons: { icon: { url: '/logo.svg', type: 'image/svg+xml' } }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {/* #app 命名空间与全局样式约定保持不变（样式全部以 #app 前缀隔离） */}
        <div id="app">{children}</div>
      </body>
    </html>
  )
}
