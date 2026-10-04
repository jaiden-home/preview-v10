'use client'

/** 自选星标按钮（行情中心 / 量化选股共用）：28px 次级触控区，激活品牌蓝实心星 */
interface StarButtonProps {
  active: boolean
  title: string
  onToggle: () => void
}

export default function StarButton({ active, title, onToggle }: StarButtonProps) {
  return (
    <button
      className={`market-star${active ? ' active' : ''}`}
      type="button"
      aria-pressed={active}
      aria-label={title}
      title={title}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3.2l2.7 5.5 6 .9-4.3 4.2 1 6L12 17l-5.4 2.8 1-6L3.3 9.6l6-.9z" />
      </svg>
    </button>
  )
}
