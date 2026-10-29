import type { Metadata } from 'next'
import ConceptAdmin from '@/components/admin/ConceptAdmin'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '概念管理',
  description: '维护概念体系：概念与大类的增删改与组内排序，概念折叠面板查看成分股。'
}

/** 概念管理页（/admin/concepts，UI_SPEC §3.17） */
export default function ConceptAdminPage() {
  return <ConceptAdmin />
}
