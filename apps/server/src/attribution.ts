import type { Prisma } from '@prisma/client'
import { db } from './database'

type Client = Prisma.TransactionClient | typeof db
const WINDOW_MS = 7 * 86400000

/** 用户在下单前 7 天内是否转过该商品的链接（转链记录里存了 SKU，旧记录按商品链接里的 SKU 判断） */
function promotedSku(accountId: string, sku: string, placedAt: Date, userId?: string): Prisma.PromotionRecordWhereInput {
  return {
    accountId,
    status: 'SUCCESS',
    userId: userId ?? { not: null },
    createdAt: { gte: new Date(placedAt.getTime() - WINDOW_MS), lte: placedAt },
    OR: [{ productSnapshot: { path: ['sku'], equals: sku } }, { sourceUrl: { contains: `/${sku}.html` } }],
  }
}

/**
 * 订单未回传用户标识（如京东 subUnionId 未开通权限）时按商品匹配下单用户：
 * 下单前 7 天内只有一个用户转过这个商品的链接，才认定为该用户；多人转过则不自动关联。
 */
export async function ownerBySku(tx: Client, accountId: string, sku: string, placedAt: Date) {
  if (!sku) return null
  const rows = await tx.promotionRecord.findMany({
    where: promotedSku(accountId, sku, placedAt),
    select: { userId: true },
    distinct: ['userId'],
    take: 2,
  })
  return rows.length === 1 ? rows[0].userId : null
}
