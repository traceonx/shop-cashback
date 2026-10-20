import { BadRequestException } from '@nestjs/common'

/** 管理员通知入口：只允许协议、主机与端口。 */
export function normalizePublicUrl(raw: string | undefined): string | null {
  const text = (raw || '').trim().replace(/\/+$/, '')
  if (!text) return null
  try {
    const u = new URL(text)
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash)
      throw new Error()
    return u.origin
  } catch {
    throw new BadRequestException('外部访问地址只填协议、域名和端口，例如 https://shihui.example.com')
  }
}
