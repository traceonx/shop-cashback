import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'
const KEY = 'shop-cashback-theme'

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(mode: ThemeMode) {
  if (mode === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', mode)
}

/** 主题：跟随系统 → 浅色 → 深色 循环切换，偏好保存在本机 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(read)
  useEffect(() => {
    apply(mode)
    try {
      if (mode === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, mode)
    } catch {
      /* 隐私模式等情况下忽略 */
    }
  }, [mode])
  const next = () => setMode((m) => (m === 'system' ? 'light' : m === 'light' ? 'dark' : 'system'))
  return { mode, next }
}

// 首屏前应用已保存的主题，避免闪烁
apply(read())
