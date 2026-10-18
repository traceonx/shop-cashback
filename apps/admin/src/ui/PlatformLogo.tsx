import { cx } from '../lib/format'

export type PlatformKey = 'jd' | 'taobao' | 'pdd' | 'wecom' | 'telegram'

/** 平台标识：品牌色圆角方块 + 简称（自绘，不使用官方商标图形） */
const meta: Record<PlatformKey, { name: string; short: string }> = {
  jd: { name: '京东', short: '京' },
  taobao: { name: '淘宝', short: '淘' },
  pdd: { name: '拼多多', short: '拼' },
  wecom: { name: '企业微信', short: '企' },
  telegram: { name: 'Telegram', short: 'TG' },
}
const byName: Record<string, PlatformKey> = Object.fromEntries(Object.entries(meta).map(([k, v]) => [v.name, k as PlatformKey]))

/** 接受平台 key（jd）或中文名（京东） */
export const platformKey = (value: string): PlatformKey | null =>
  value in meta ? (value as PlatformKey) : byName[value] || null

export function PlatformLogo({ platform, size = 'md' }: { platform: string; size?: 'sm' | 'md' | 'lg' }) {
  const key = platformKey(platform)
  if (!key) return null
  return (
    <span className={cx('platform-logo', `platform-${key}`, `platform-logo-${size}`)} aria-hidden="true">
      {meta[key].short}
    </span>
  )
}

/** 表格中的平台：标识 + 名称 */
export function PlatformTag({ platform }: { platform: string }) {
  const key = platformKey(platform)
  return (
    <span className="platform-tag">
      <PlatformLogo platform={platform} size="sm" />
      {key ? meta[key].name : platform || '—'}
    </span>
  )
}
