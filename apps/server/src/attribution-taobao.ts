import type { Prisma } from '@prisma/client'
import { db } from './database'

type Client = Prisma.TransactionClient | typeof db
const BEFORE_MS = 7 * 86400000
// 转链后很快下单时，淘宝记录的下单时间与本系统时间可能有偏差，统计「有几个人转过」时多看 10 分钟
const AFTER_MS = 10 * 60000
const UNKNOWN = new Set(['', '淘宝商品', '商品信息暂不可用', '商品信息待查询'])

/** 标题归一化：去掉【活动标签】、空白与常见标点，大小写不敏感 */
export const normTitle = (t: unknown) =>
  String(t ?? '')
    .replace(/【[^】]*】/g, '')
    .replace(/[\s\-_/|·,，。.!！?？:：;；()（）[\]「」"'“”]+/g, '')
    .toLowerCase()

type Rec = { userId: string | null; productSnapshot: unknown }
/**
 * 淘宝订单按商品匹配下单用户（纯函数，便于测试）：
 * - 统计「可能是同一商品」的转链用户时放宽：商品 ID 相同、完整标题相同、标题互相包含（≥10 字），或转链记录没有商品信息（无法排除），都算一个候选用户；
 * - 自动关联时收紧：候选用户只有一人，且此人有一条商品 ID 或完整标题完全一致的记录。
 * 两个及以上用户可能转过同一商品时不关联，进入人工关联。
 */
export function decideTaobaoOwner(records: Rec[], sku: string, title: string): string | null {
  const t = normTitle(title)
  const possible = new Set<string>(),
    exact = new Set<string>()
  for (const r of records) {
    if (!r.userId) continue
    const snap = (r.productSnapshot && typeof r.productSnapshot === 'object' ? r.productSnapshot : {}) as { sku?: unknown; product?: unknown }
    const rs = typeof snap.sku === 'string' ? snap.sku : ''
    const nt = normTitle(snap.product)
    const strict = (!!sku && rs === sku) || (!!t && nt === t)
    const loose = strict || (!!t && !!nt && Math.min(t.length, nt.length) >= 10 && (t.includes(nt) || nt.includes(t)))
    const unknown = !rs && UNKNOWN.has(String(snap.product ?? '').trim())
    if (strict) exact.add(r.userId)
    if (loose || unknown) possible.add(r.userId)
  }
  if (possible.size !== 1 || exact.size !== 1) return null
  const [only] = possible
  return exact.has(only) ? only : null
}

export async function ownerByTaobaoProduct(tx: Client, accountId: string, sku: string, title: string, placedAt: Date) {
  if (!sku && normTitle(title).length < 8) return null
  const records = await tx.promotionRecord.findMany({
    where: {
      accountId,
      status: 'SUCCESS',
      userId: { not: null },
      createdAt: { gte: new Date(placedAt.getTime() - BEFORE_MS), lte: new Date(placedAt.getTime() + AFTER_MS) },
    },
    select: { userId: true, productSnapshot: true },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  })
  return decideTaobaoOwner(records, sku, title)
}
