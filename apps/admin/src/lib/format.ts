/** 拼接 className，忽略假值 */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

/** 分 → ¥0.00 */
export const money = (cents: number) =>
  `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 金额字段：空值显示「待确认」 */
export const amount = (value: unknown) => (value == null || value === '' ? '待确认' : money(Number(value)))

export const dateTime = (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—')

/** 字节 → MB（一位小数） */
export const mb = (n = 0) => (n / 1048576).toFixed(1)

/** 距离某时刻已过去的时长 */
export const elapsed = (from?: string) => {
  if (!from) return ''
  const s = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 1000))
  return s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s} 秒`
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export type Notify = (message: string) => void
