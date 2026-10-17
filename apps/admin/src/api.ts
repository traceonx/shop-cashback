export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('rebate-token-v2')
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
      sessionStorage.removeItem('rebate-token-v2')
      window.dispatchEvent(new Event('session-expired'))
    }
    throw new Error(result.message || '请求失败，请稍后重试')
  }
  return result.data as T
}
export const money = (cents: number) =>
  `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export type Row = { id: string; [key: string]: string | number | boolean | null }
