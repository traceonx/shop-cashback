const TOKEN_KEY = 'rebate-token-v2'

export type Row = { id: string; [key: string]: string | number | boolean | null }

export const auth = {
  token: () => sessionStorage.getItem(TOKEN_KEY),
  save: (token: string, role: string) => {
    sessionStorage.setItem(TOKEN_KEY, token)
    sessionStorage.setItem('rebate-role', role)
  },
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
}

/** 调用后端 /api/v1 接口，返回 data 字段；401 时清除登录并广播 session-expired */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = auth.token()
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  let result
  try {
    result = await res.json()
  } catch {
    throw new Error('无法连接 API 服务，请确认后端已启动')
  }
  if (!res.ok) {
    if (res.status === 401) {
      auth.clear()
      window.dispatchEvent(new Event('session-expired'))
    }
    throw new Error(result.message || '请求失败，请稍后重试')
  }
  return result.data as T
}

/** 带登录凭证下载文件 */
export async function download(path: string, filename: string) {
  const token = auth.token()
  const res = await fetch(`/api/v1${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('下载失败')
  saveBlob(await res.blob(), filename)
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}
