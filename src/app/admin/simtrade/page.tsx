import type { Metadata } from 'next'
import SimSettings from '@/components/simtrade/SimSettings'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '模拟设置',
  description: '极速模拟设置：模拟标的、起始与结束日期、倍速、开始暂停与重置账户控制。'
}

/** 极速模拟设置页（/admin/simtrade，UI_SPEC §3.14） */
export default function SimTradeSettingsPage() {
  return <SimSettings />
}
