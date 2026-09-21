import { NextResponse } from 'next/server'
import { logger } from '@/lib/server/logger'

export const dynamic = 'force-dynamic'

/** 存活探针：进程可达即健康（Docker HEALTHCHECK / LB 探测） */
export async function GET() {
  logger.debug('healthz probed')
  return NextResponse.json(
    { status: 'ok', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
