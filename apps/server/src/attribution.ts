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

/** 用户通过订单号找回订单：仅当该用户下单前转过同一商品的链接时才关联 */
export async function claimOrder(userId: string, orderNo: string) {
  const lines = await db.affiliateOrder.findMany({ where: { externalOrderId: orderNo }, include: { items: true } })
  if (!lines.length) return '没有找到该订单。订单同步约有 10 分钟延迟，请稍后再试；如长时间找不到，请联系管理员。'
  if (lines.every((o) => o.userId === userId)) return '该订单已在你的账户中，发送 /订单 可查看。'
  if (lines.some((o) => o.userId && o.userId !== userId)) return '该订单已关联到其他账户，如有疑问请联系管理员。'
  const verified = []
  for (const o of lines) {
    const sku = o.items[0]?.sku || ''
    if (sku && (await db.promotionRecord.findFirst({ where: promotedSku(o.accountId, sku, o.placedAt, userId), select: { id: true } })))
      verified.push(o)
  }
  if (!verified.length) return '无法核实该订单是通过你发送的链接购买的（需要在下单前 7 天内发送过该商品链接）。如有疑问请联系管理员。'
  await db.$transaction([
    ...verified.map((o) => db.affiliateOrder.update({ where: { id: o.id }, data: { userId } })),
    db.auditLog.create({
      data: { actorId: userId, action: '用户找回订单', targetId: orderNo, traceId: 'wecom', diff: { lines: verified.map((o) => o.id) } },
    }),
  ])
  return `已找回订单：${verified.map((o) => o.items[0]?.title || '商品').join('、')}，发送 /订单 可查看。`
}
