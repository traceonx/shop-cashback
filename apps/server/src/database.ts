import './config'
import { PrismaClient, Prisma } from '@prisma/client'
export const db = new PrismaClient({ log: ['error'] })
export const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue
export const dateText = (date: Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
export function centsNumber(value: bigint | null | undefined) {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isSafeInteger(n)) throw new Error('金额超过可安全展示范围')
  return n
}
export const audit = (actorId: string, action: string, targetId: string, traceId: string, diff: unknown = {}) =>
  db.auditLog.create({ data: { actorId, action, targetId, traceId, diff: json(diff) } })
