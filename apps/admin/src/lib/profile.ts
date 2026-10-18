import { useEffect, useState } from 'react'
import { api } from './api'

export type Profile = { id: string; name: string; role: string; nickname: string; avatar: string | null }

const EVENT = 'profile-changed'
let cache: Profile | null = null

/** 当前管理员信息（头像、昵称），在顶栏和个人信息页之间共享 */
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(cache)
  useEffect(() => {
    const update = () => setProfile(cache)
    window.addEventListener(EVENT, update)
    if (!cache) void refreshProfile()
    return () => window.removeEventListener(EVENT, update)
  }, [])
  return profile
}

export async function refreshProfile() {
  try {
    setProfile(await api<Profile>('/auth/profile'))
  } catch {
    /* 未登录或网络错误时忽略 */
  }
}

export function setProfile(p: Profile) {
  cache = p
  window.dispatchEvent(new Event(EVENT))
}

export const displayName = (p: Profile | null) => p?.nickname || p?.name || '管理员'
export const roleName = (role?: string) => (role === 'SUPER_ADMIN' || role === 'admin' || !role ? '管理员' : role)

/** 读取图片并压缩为不超过 256px 的 WebP data URL（体积通常 < 60KB） */
export async function compressAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('无法读取图片'))
      i.src = url
    })
    const size = 256
    const scale = Math.min(1, size / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const webp = canvas.toDataURL('image/webp', 0.85)
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}
