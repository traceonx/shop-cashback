// 京东「一人一个推广位」：每个返现用户固定绑定一个京东联盟推广位，转链时传该推广位 ID（positionId），
// 订单行里的 positionId 即可精确对应到用户。positionId 不需要额外权限（subUnionId 子联盟 ID 需京东单独开通）。
// 推广位由管理员在京东联盟后台「推广管理 → 推广位」建好后填入「推广位池」（positionPool），取第一个未绑定的；
// 池子用完时使用默认推广位，订单按商品匹配兜底。绑定后不回收。
// 绑定关系保存在 system_configs：jd-position:<推广位ID> → 用户，jd-position-user:<用户ID> → 推广位（成对写入，主键唯一兜底并发）。
import { BadRequestException } from '@nestjs/common'
import type { PlatformConfig } from '../types'

const POS = /^\d{1,20}$/
const posKey = (id: string) => `jd-position:${id}`
const userKey = (userId: string) => `jd-position-user:${userId}`

/** 解析推广位池：数字推广位 ID，逗号、空格或换行分隔；去重，排除默认推广位。strict 时遇到无效项抛错。 */
export function parsePositionPool(text: string | undefined, defaults: (string | undefined)[], strict = false): string[] {
  const skip = new Set(defaults.map((d) => d?.trim()).filter(Boolean))
  const out: string[] = []
  for (const item of String(text || '').split(/[\s,，;；]+/).filter(Boolean)) {
    const bad = !POS.test(item) ? `「${item.slice(0, 30)}」不是推广位 ID（纯数字）` : skip.has(item) ? `${item} 是默认推广位，不能放进推广位池` : null
    if (bad) {
      if (strict) throw new BadRequestException(`推广位池：${bad}`)
      continue
    }
    if (!out.includes(item)) out.push(item)
  }
  return out
}

export interface PositionStore {
  find(userId: string): Promise<string | null>
  used(): Promise<Set<string>>
  /** 绑定；推广位已被别人占用时返回 false */
  save(userId: string, positionId: string): Promise<boolean>
  owner(positionId: string): Promise<string | null>
}

let queue: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

/** 取用户的京东推广位；没有则从推广位池分配。返回 null 表示池里没有空闲推广位。 */
export async function ensureUserPosition(store: PositionStore, pool: string[], userId: string): Promise<string | null> {
  const existing = await store.find(userId)
  if (existing) return existing
  if (!pool.length) return null
  return serial(async () => {
    const again = await store.find(userId)
    if (again) return again
    const used = await store.used()
    for (const id of pool) if (!used.has(id) && (await store.save(userId, id))) return id
    return null
  })
}

type Tx = { systemConfig: any }
export function dbPositionStore(client?: Tx): PositionStore {
  const get = async (): Promise<any> => client ?? (await import('../../database')).db
  return {
    async find(userId) {
      const row = await (await get()).systemConfig.findUnique({ where: { key: userKey(userId) } })
      return row?.value?.positionId ?? null
    },
    async used() {
      const rows = await (await get()).systemConfig.findMany({ where: { key: { startsWith: 'jd-position:' } }, select: { key: true } })
      return new Set(rows.map((r: { key: string }) => r.key.slice('jd-position:'.length)))
    },
    async save(userId, positionId) {
      const db = await get()
      try {
        await db.$transaction(async (tx: Tx) => {
          await tx.systemConfig.create({ data: { key: posKey(positionId), value: { userId, at: new Date().toISOString() } } })
          await tx.systemConfig.create({ data: { key: userKey(userId), value: { positionId } } })
        })
        return true
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') return false
        throw e
      }
    },
    async owner(positionId) {
      const row = await (await get()).systemConfig.findUnique({ where: { key: posKey(positionId) } })
      return row?.value?.userId ?? null
    },
  }
}

/** 推广位池与绑定情况（后台展示用） */
export async function positionBindings(pool: string[]) {
  const { db } = await import('../../database')
  const rows = await db.systemConfig.findMany({ where: { key: { startsWith: 'jd-position:' } } })
  const bound = new Map(rows.map((r) => [r.key.slice('jd-position:'.length), r.value as { userId: string; at: string }]))
  const users = await db.user.findMany({ where: { id: { in: [...bound.values()].map((b) => b.userId) } }, select: { id: true, name: true } })
  const name = new Map(users.map((u) => [u.id, u.name]))
  const ids = [...pool, ...[...bound.keys()].filter((id) => !pool.includes(id))]
  return {
    pool: ids.map((id) => {
      const b = bound.get(id)
      return { positionId: id, inPool: pool.includes(id), user: b ? { id: b.userId, name: name.get(b.userId) || '已删除用户' } : null, boundAt: b?.at ?? null }
    }),
    free: pool.filter((id) => !bound.has(id)).length,
  }
}
