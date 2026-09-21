import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="ssr-skeleton-chart" style={{ flexDirection: 'column', gap: 12 }}>
      <div>未找到该标的：请检查代码格式（如 sh600519 / sz000001 / bj430047）</div>
      <Link className="tb-btn modal-btn" href="/" style={{ border: '1px solid var(--tb-border)' }}>
        返回首页
      </Link>
    </div>
  )
}
