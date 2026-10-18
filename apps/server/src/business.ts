import { randomBytes } from 'node:crypto'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { db, json, dateText, centsNumber, audit } from './database'
import { readConfig } from './integrations'
import { platformForContent, platform } from './platforms/registry'

export async function settings() {
  const row = await db.systemConfig.findUnique({ where: { key: 'rules' } })
  return (row?.value as { ratio: number; minimum: number } | undefined) || { ratio: 70, minimum: 10 }
}
/** 订单当前状态：待核实归属的订单按平台原始状态换算 */
function orderStatus(o: { platform: string; status: string; rawStatus: string | null }) {
  if (o.status !== 'UNATTRIBUTED') return o.status
  try {
    return platform(o.platform).orderStatus(o.rawStatus || '')
  } catch {
    return o.status
  }
}
export async function overview() {
  const start = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) + 'T00:00:00+08:00')
  const [conversions, success, active, pending, todayOrders, wallets] = await Promise.all([
    db.promotionRecord.count({ where: { createdAt: { gte: start } } }),
    db.promotionRecord.count({ where: { createdAt: { gte: start }, status: 'SUCCESS' } }),
    db.promotionRecord.groupBy({ by: ['userId'], where: { createdAt: { gte: start }, userId: { not: null } } }),
    db.withdrawalRequest.count({ where: { status: 'PENDING_REVIEW' } }),
    db.affiliateOrder.findMany({
      where: { placedAt: { gte: start } },
      select: { platform: true, status: true, rawStatus: true, commissionCents: true },
    }),
    db.walletAccount.aggregate({ _sum: { pendingCents: true, withdrawnCents: true } }),
  ])
  // 已取消的订单不计入今日订单与预估佣金
  const valid = todayOrders.filter((o) => orderStatus(o) !== 'CANCELLED')
  return {
    conversions,
    successRate: conversions ? Math.round((success / conversions) * 1000) / 10 : 0,
    active: active.length,
    pending,
    newOrders: valid.length,
    commission: valid.reduce((sum, o) => sum + (centsNumber(o.commissionCents) || 0), 0),
    settlement: centsNumber(wallets._sum.pendingCents) || 0,
    withdrawn: centsNumber(wallets._sum.withdrawnCents) || 0,
  }
}
export async function trends(days: number) {
  const end = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) + 'T00:00:00+08:00')
  const start = new Date(end.getTime() - (days - 1) * 86400000)
  const records = (
    await db.affiliateOrder.findMany({ where: { placedAt: { gte: start } }, select: { placedAt: true, platform: true, status: true, rawStatus: true } })
  ).filter((o) => orderStatus(o) !== 'CANCELLED')
  const counts = new Map<string, number>()
  for (const r of records) {
    const key = dateText(r.placedAt).slice(0, 10)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000),
      key = dateText(d).slice(0, 10)
    return { date: key.slice(5).replace('-', '/'), count: counts.get(key) || 0 }
  })
}
export async function listUsers() {
  const list = await db.user.findMany({
    include: { identities: true, wallet: true, _count: { select: { promotions: true, orders: true } } },
    orderBy: { createdAt: 'desc' },
  })
  const rules = await db.rebateRule.findMany()
  const defaults = await settings()
  return list.map((u) => ({
    id: u.id,
    name: u.name,
    externalId: u.identities[0]?.externalUserId || '',
    channel: '企业微信',
    conversions: u._count.promotions,
    orders: u._count.orders,
    total: centsNumber(u.wallet?.totalCents) || 0,
    balance: centsNumber(u.wallet?.availableCents) || 0,
    ratio: (rules.find((r) => r.scopeKey === `user:${u.id}`)?.basisPoints ?? defaults.ratio * 100) / 100,
    status: u.enabled ? 'ACTIVE' : 'DISABLED',
    createdAt: dateText(u.createdAt),
  }))
}
export async function listPromotions() {
  return (await db.promotionRecord.findMany({ include: { user: true }, orderBy: { createdAt: 'desc' } })).map((p) => ({
    ...((p.productSnapshot as object) || {}),
    id: p.id,
    user: p.user?.name || '管理员测试',
    userId: p.userId || '',
    product: (p.productSnapshot as any)?.product || '商品信息待查询',
    channel: p.channelId === 'admin' ? '管理后台' : '企业微信',
    status: p.status,
    originalUrl: p.sourceUrl,
    promotionUrl: p.promotionUrl,
    createdAt: dateText(p.createdAt),
    error: p.errorCode,
  }))
}
export async function convert(content: string, actor: string, trace: string, userId?: string) {
  const { plugin, url } = platformForContent(content)
  const c = await readConfig(plugin.id)
  if (!plugin.configured(c)) throw new BadRequestException('请先保存该平台的应用凭证')
  let trackingCode = ''
  if (userId) {
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user?.enabled) throw new BadRequestException('返现用户不存在或已禁用')
    const tracking = await db.userTrackingCode.upsert({
      where: { accountId_userId: { accountId: plugin.accountId, userId } },
      create: { accountId: plugin.accountId, userId, code: randomBytes(16).toString('hex') },
      update: {},
    })
    trackingCode = tracking.code
  }
  const record = await db.promotionRecord.create({
    data: {
      userId: userId || null,
      channelId: userId ? 'wecom-primary' : 'admin',
      accountId: plugin.accountId,
      trackingCode,
      sourceUrl: url,
      status: 'PROCESSING',
    },
  })
  try {
    const { link, snapshot } = await plugin.convert(c, url, trackingCode || undefined, content)
    const rule = userId ? await db.rebateRule.findFirst({ where: { scopeKey: 'user:' + userId } }) : null
    const basisPoints = rule?.basisPoints ?? Math.round((await settings()).ratio * 100)
    snapshot.rebate =
      snapshot.commission === null ? null : Number((BigInt(snapshot.commission) * BigInt(basisPoints)) / 10000n)
    snapshot.finalPrice =
      snapshot.payablePrice != null && snapshot.rebate !== null
        ? Math.max(0, snapshot.payablePrice - snapshot.rebate)
        : null
    await db.promotionRecord.update({
      where: { id: record.id },
      data: { status: 'SUCCESS', promotionUrl: link, productSnapshot: json(snapshot) },
    })
    await audit(actor, '商品转链', record.id, trace, { status: 'SUCCESS' })
    return {
      ...snapshot,
      id: record.id,
      originalUrl: url,
      promotionUrl: link,
      status: 'SUCCESS',
      createdAt: dateText(record.createdAt),
    }
  } catch (e) {
    await db.promotionRecord.update({
      where: { id: record.id },
      data: { status: 'FAILED', errorCode: e instanceof Error ? e.message : '转链失败' },
    })
    throw e
  }
}
export async function listOrders() {
  const defaults = await settings()
  return (
    await db.affiliateOrder.findMany({ include: { user: true, items: true }, orderBy: { placedAt: 'desc' } })
  ).map((o) => {
    const snapshot = o.ruleSnapshot as { basisPoints?: number } | null
    const values = platform(o.platform).orderAmounts(o.rawData)
    const currentStatus = o.status === 'UNATTRIBUTED' ? platform(o.platform).orderStatus(o.rawStatus || '') : o.status
    const ratio = snapshot?.basisPoints != null ? snapshot.basisPoints / 100 : defaults.ratio
    const commission = values.commission ?? centsNumber(o.commissionCents)
    const preview =
      currentStatus === 'CANCELLED'
        ? 0
        : ['COMPLETED', 'PAID', 'CREATED'].includes(currentStatus) && commission !== null
          ? Number((BigInt(commission) * BigInt(Math.round(ratio * 100))) / 10000n)
          : null
    return {
      id: o.id,
      externalOrderId: o.externalOrderId,
      product: o.items[0]?.title || '商品信息待确认',
      sku: o.items[0]?.sku || '',
      platform: ({ jd: '京东', taobao: '淘宝', pdd: '拼多多' } as Record<string, string>)[o.platform] || o.platform,
      user: o.user?.name || '未关联用户',
      userId: o.userId || '',
      attribution: o.userId ? '已关联' : '未关联',
      amount: centsNumber(o.amountCents) ?? values.amount,
      commissionBase: values.commissionBase,
      paidAmount: values.commissionBase ?? centsNumber(o.paidAmountCents),
      imageUrl: platform(o.platform).orderImage(o.rawData),
      rebate: currentStatus === 'CANCELLED' ? 0 : (centsNumber(o.rebateCents) ?? preview),
      ratioNote: snapshot?.basisPoints != null ? '下单比例快照' : '按当前全局规则预估，非下单快照',
      ratio,
      commission,
      status: o.status === 'UNATTRIBUTED' ? platform(o.platform).orderStatus(o.rawStatus || '') : o.status,
      rawStatus: o.rawStatus,
      createdAt: dateText(o.placedAt),
      completedAt: o.completedAt ? dateText(o.completedAt) : null,
    }
  })
}
export async function listWithdrawals() {
  return (
    await db.withdrawalRequest.findMany({ include: { user: true, payments: true }, orderBy: { createdAt: 'desc' } })
  ).map((w) => ({
    id: w.id,
    user: w.user.name,
    userId: w.userId,
    amount: centsNumber(w.amountCents),
    status: w.status,
    createdAt: dateText(w.createdAt),
    note: w.reviewNote || '',
    proof: w.payments[0]?.proofObjectKey || '',
  }))
}
export async function withdrawalAction(
  id: string,
  action: string,
  note: string,
  proof: string,
  actor: string,
  trace: string,
) {
  if (!['approve', 'reject', 'confirm-payment'].includes(action)) throw new BadRequestException('无效操作')
  if (action === 'reject' && !note.trim()) throw new BadRequestException('拒绝申请必须填写原因')
  if (action === 'confirm-payment' && !proof.trim()) throw new BadRequestException('必须填写实际人工打款凭证编号')
  try {
    return await db.$transaction(
      async (tx) => {
        const request = await tx.withdrawalRequest.findUnique({ where: { id } })
        if (!request) throw new NotFoundException('申请不存在')
        const expected = action === 'confirm-payment' ? 'PENDING_PAYMENT' : 'PENDING_REVIEW',
          status = action === 'approve' ? 'PENDING_PAYMENT' : action === 'reject' ? 'REJECTED' : 'COMPLETED'
        const updated = await tx.withdrawalRequest.updateMany({
          where: { id, status: expected, version: request.version },
          data: { status, version: { increment: 1 }, reviewNote: note, reviewerId: actor, reviewedAt: new Date() },
        })
        if (updated.count !== 1) throw new BadRequestException('申请状态已改变，请刷新；不会重复处理')
        if (action !== 'approve') {
          const wallet = await tx.walletAccount.findUnique({ where: { userId: request.userId } })
          if (!wallet || wallet.frozenCents < request.amountCents) throw new BadRequestException('冻结余额不足')
          const changed = await tx.walletAccount.updateMany({
            where: { id: wallet.id, version: wallet.version, frozenCents: { gte: request.amountCents } },
            data: {
              frozenCents: { decrement: request.amountCents },
              ...(action === 'reject'
                ? { availableCents: { increment: request.amountCents } }
                : { withdrawnCents: { increment: request.amountCents } }),
              version: { increment: 1 },
            },
          })
          if (changed.count !== 1) throw new BadRequestException('账户余额已改变，请重试')
          const base = { walletId: wallet.id, referenceId: id, reason: note || '人工打款确认', actorId: actor }
          await tx.walletTransaction.create({
            data: {
              ...base,
              businessKey: `withdrawal:${id}:${action}:frozen`,
              kind: action,
              bucket: 'frozen',
              deltaCents: -request.amountCents,
              beforeCents: wallet.frozenCents,
              afterCents: wallet.frozenCents - request.amountCents,
            },
          })
          const before = action === 'reject' ? wallet.availableCents : wallet.withdrawnCents
          await tx.walletTransaction.create({
            data: {
              ...base,
              businessKey: `withdrawal:${id}:${action}:destination`,
              kind: action,
              bucket: action === 'reject' ? 'available' : 'withdrawn',
              deltaCents: request.amountCents,
              beforeCents: before,
              afterCents: before + request.amountCents,
            },
          })
          if (action === 'confirm-payment')
            await tx.withdrawalPayment.create({
              data: {
                withdrawalId: id,
                idempotencyKey: `paid:${id}`,
                proofObjectKey: proof,
                actorId: actor,
                amountCents: request.amountCents,
                paidAt: new Date(),
              },
            })
        }
        await tx.auditLog.create({
          data: { actorId: actor, action: `提现 ${action}`, targetId: id, traceId: trace, diff: { status, note } },
        })
        return { id, status }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(e.code))
      throw new BadRequestException('操作冲突或已处理，请刷新后重试')
    throw e
  }
}
