import { BadRequestException } from '@nestjs/common'
import type { PlatformPlugin } from './types'
import { jdPlugin } from './jd'

const plugins = new Map<string, PlatformPlugin>([[jdPlugin.id, jdPlugin]])
export const listPlatforms = () => [...plugins.values()]
export function platform(id: string) {
  const plugin = plugins.get(id)
  if (!plugin) throw new BadRequestException('该平台插件尚未接入')
  return plugin
}
export function platformForContent(content: string) {
  for (const plugin of plugins.values()) {
    try {
      return { plugin, url: plugin.normalizeUrl(content) }
    } catch {}
  }
  throw new BadRequestException('链接不属于已接入的平台，请使用已启用平台的 HTTPS 商品链接')
}
