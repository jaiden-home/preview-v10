import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 输出自包含产物，供 Docker 镜像内 `node server.js` 直接运行
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // 允许局域网 IP 访问开发服务器（HMR 跨源放行）
  allowedDevOrigins: ['192.168.7.99'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
        ]
      }
    ]
  }
}

export default nextConfig
