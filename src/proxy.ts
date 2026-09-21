import { NextResponse, type NextRequest } from 'next/server'

const RESERVED_ROOT_SEGMENTS = new Set(['api', '_next', 'favicon.ico', 'logo.svg', 'robots.txt', 'trade'])
const SYMBOL_PATTERN = /^(sh|sz|bj)\d{6}$/

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>404 | KLineChart</title>
  </head>
  <body style="margin:0;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#76808f;font-size:14px">
    未找到该标的：请检查代码格式（如 sh600519 / sz000001 / bj430047）
    <a href="/" style="margin-left:12px;color:#1677ff">返回首页</a>
  </body>
</html>`

/**
 * 边界代理：
 * 1. 非法标的路由在边缘直接 404（Next 流式响应下，页面内 notFound()
 *    在响应头冲刷后抛出，无法改变状态码）
 * 2. 为 API 请求注入 x-request-id（已有则透传），供日志关联与链路追踪
 */
export function proxy(request: NextRequest) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean)
  if (
    segments.length === 1 &&
    !RESERVED_ROOT_SEGMENTS.has(segments[0]) &&
    !SYMBOL_PATTERN.test(decodeURIComponent(segments[0]))
  ) {
    return new NextResponse(NOT_FOUND_HTML, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  }

  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
  const response = NextResponse.next()
  response.headers.set('x-request-id', requestId)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)']
}
