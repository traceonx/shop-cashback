// 淘宝「一人一个推广位」：每个返现用户固定绑定一个推广位（PID 的第四段即 adzone_id），转链用该用户的 PID，
// 订单里的 adzone_id 即可精确对应到用户（与京东 subUnionId 一样作为联盟回传标识）。
// 推广位来源按顺序：
//   1. 推广位池（adzonePool）：管理员在淘宝联盟后台建好、填进配置的 PID，取第一个未绑定的；
//   2. 池子用完且开启喵有券淘宝接入时，调用喵有券 taoke/adzoneCreate 自动创建
//      （https://www.ecapi.cn/index/index/openapi/id/333.shtml?ptype=1，付费会员接口），建在默认 PID 的同一网站下；
//   3. 都不行时返回 null，由调用方使用默认 PID（订单按商品匹配兜底）。
// 绑定后不回收：推广位一直属于这个用户，旧链接多久以后下单都能对上。
import { BadRequestException } from '@nestjs/common'
import type { PlatformConfig } from '../types'
import { ecapiCall } from '../jd/ecapi'

export const TAOBAO_ACCOUNT = 'taobao-primary'
const PID = /^mm_(\d+)_(\d+)_(\d+)$/
export const isAdzoneCode = (code: unknown): code is string => typeof code === 'string' && /^\d{4,20}$/.test(code)
export const perUserAdzoneEnabled = (official: PlatformConfig) => official.perUserAdzone !== 'false'

export interface PoolEntry {
  adzone: string
  pid: string
}
/**
 * 解析推广位池：每行（或逗号、空格分隔）一个 PID，必须与默认 PID 同一淘宝联盟账号；去重，排除默认推广位。
 * strict 时遇到无效项抛错（保存配置时使用），否则跳过。
 */
export function parseAdzonePool(text: string | undefined, official: PlatformConfig, strict = false): PoolEntry[] {
  const account = PID.exec(official.pid || '')?.[1]
  const out: PoolEntry[] = []
  const seen = new Set<string>()
  for (const item of String(text || '').split(/[\s,，;；]+/).filter(Boolean)) {
    const m = PID.exec(item)
    const bad = !m ? `「${item.slice(0, 40)}」不是 PID（mm_账号_网站_推广位）` : account && m[1] !== account ? `${item} 不属于默认 PID 的联盟账号` : m[3] === official.adzoneId ? `${item} 是默认推广位，不能放进推广位池` : null
    if (bad) {
      if (strict) throw new BadRequestException(`推广位池：${bad}`)
      continue
    }
    if (seen.has(m![3])) continue
    seen.add(m![3])
    out.push({ adzone: m![3], pid: item })
  }
  return out
}

/** 用户推广位对应的完整 PID：池里的按池中 PID；自动创建的在默认 PID 的网站下 */
export function userPid(official: PlatformConfig, adzoneId: string) {
  const pooled = parseAdzonePool(official.adzonePool, official).find((e) => e.adzone === adzoneId)
  if (pooled) return pooled.pid
  const m = PID.exec(official.pid || '')
  return m ? `mm_${m[1]}_${m[2]}_${adzoneId}` : null
}

export interface AdzoneStore {
  find(userId: string): Promise<string | null>
  /** 已绑定给用户的推广位 ID */
  used(): Promise<Set<string>>
  /** 绑定；推广位已被别人占用（并发）时返回 false */
  save(userId: string, adzoneId: string): Promise<boolean>
}
export type AdzoneCreate = (params: Record<string, string>) => Promise<any>

// 同一进程内串行分配，避免两个用户同时拿到池里同一个推广位（数据库唯一约束再兜底）
let queue: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

/** 取用户的推广位 ID；没有则从推广位池分配或自动创建并保存。返回 null 表示没有可用推广位。 */
export async function ensureUserAdzone(
  store: AdzoneStore,
  official: PlatformConfig,
  third: PlatformConfig | null,
  userId: string,
  create: AdzoneCreate = (p) => ecapiCall('taoke/adzoneCreate', p),
): Promise<string | null> {
  const existing = await store.find(userId)
  if (isAdzoneCode(existing)) return existing
  return serial(async () => {
    const again = await store.find(userId)
    if (isAdzoneCode(again)) return again
    const used = await store.used()
    for (const entry of parseAdzonePool(official.adzonePool, official)) {
      if (!used.has(entry.adzone) && (await store.save(userId, entry.adzone))) return entry.adzone
    }
    const m = PID.exec(official.pid || '')
    if (!m || !third || third.enabled !== 'true' || !third.apiKey?.trim() || !third.tbname?.trim()) return null
    const data = await create({ apkey: third.apiKey.trim(), tbname: third.tbname.trim(), site_id: m[2], adzone_name: `拾惠用户-${userId.slice(0, 8)}` })
    const got = PID.exec(String(data?.model ?? data?.pid ?? data ?? ''))
    if (!got || got[1] !== m[1] || got[2] !== m[2]) throw new BadRequestException('喵有券未返回本账号下的推广位 PID')
    if (!(await store.save(userId, got[3]))) throw new BadRequestException('新建的推广位已被占用')
    return got[3]
  })
}

export function dbAdzoneStore(): AdzoneStore {
  const load = () => import('../../database')
  return {
    async find(userId) {
      const { db } = await load()
      const row = await db.userTrackingCode.findUnique({ where: { accountId_userId: { accountId: TAOBAO_ACCOUNT, userId } } })
      return row?.code ?? null
    },
    async used() {
      const { db } = await load()
      const rows = await db.userTrackingCode.findMany({ where: { accountId: TAOBAO_ACCOUNT }, select: { code: true } })
      return new Set(rows.map((r) => r.code).filter(isAdzoneCode))
    },
    // 旧版本为淘宝也生成过随机标识（淘宝订单不会回传），直接替换为推广位 ID
    async save(userId, adzoneId) {
      const { db } = await load()
      try {
        await db.userTrackingCode.upsert({
          where: { accountId_userId: { accountId: TAOBAO_ACCOUNT, userId } },
          create: { accountId: TAOBAO_ACCOUNT, userId, code: adzoneId },
          update: { code: adzoneId },
        })
        return true
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') return false
        throw e
      }
    },
  }
}

/** 推广位池与绑定情况（后台展示用） */
export async function adzoneBindings(official: PlatformConfig) {
  const { db } = await import('../../database')
  const rows = await db.userTrackingCode.findMany({
    where: { accountId: TAOBAO_ACCOUNT },
    select: { code: true, updatedAt: true, user: { select: { id: true, name: true } } },
  })
  const byCode = new Map(rows.filter((r) => isAdzoneCode(r.code)).map((r) => [r.code, r]))
  const pool = parseAdzonePool(official.adzonePool, official)
  const inPool = new Set(pool.map((e) => e.adzone))
  const item = (adzone: string, pid: string | null, source: 'POOL' | 'CREATED') => {
    const r = byCode.get(adzone)
    return { adzone, pid, source, user: r ? { id: r.user.id, name: r.user.name } : null, boundAt: r ? r.updatedAt.toISOString() : null }
  }
  return {
    pool: pool.map((e) => item(e.adzone, e.pid, 'POOL')),
    created: [...byCode.keys()].filter((c) => !inPool.has(c)).map((c) => item(c, userPid(official, c), 'CREATED')),
    free: pool.filter((e) => !byCode.has(e.adzone)).length,
  }
}
