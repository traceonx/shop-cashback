import { wakeAutoSync } from './auto-sync'
import { randomBytes } from 'node:crypto'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { db, json, dateText, centsNumber, audit } from './database'
import { readConfig } from './integrations'
import { platformForContent, platform } from './platforms/registry'
import { ECAPI_KIND, ecapiConvert, ecapiEnabled } from './platforms/jd/ecapi'
import { TB_ECAPI_KIND, tbEcapiEnabled, tbHybridConvert } from './platforms/taobao/ecapi'
import { convertWeb, withWebFallback } from './platforms/taobao/web'
import { dbPositionStore, ensureUserPosition, parsePositionPool } from './platforms/jd/positions'
import { TAOBAO_ACCOUNT, dbAdzoneStore, ensureUserAdzone, isAdzoneCode, perUserAdzoneEnabled, userPid } from './platforms/taobao/adzones'

export async function settings() {
  const row = await db.systemConfig.findUnique({ where: { key: 'rules' } })
  return (row?.value as { ratio: number; minimum: number } | undefined) || { ratio: 70, minimum: 10 }
}
/** 订单当前状态：待核实归属的订单按平台原始状态换算 */
/** 计入订单统计：已付款及之后的有效订单 */
const counted = (status: string) => status !== 'CANCELLED' && status !== 'CREATED'
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
  // 已取消、未付款的订单不计入今日订单与预估佣金
  const valid = todayOrders.filter((o) => counted(orderStatus(o)))
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
  ).filter((o) => counted(orderStatus(o)))
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
    include: { identities: true, wallet: true, tracking: true, _count: { select: { promotions: true, orders: true } } },
    orderBy: { createdAt: 'desc' },
  })
  // 用户绑定的推广位：淘宝存于 user_tracking_codes（推广位 ID），京东存于 system_configs（jd-position-user:<用户>）
  const taobao = await readConfig('taobao')
  const jdRows = await db.systemConfig.findMany({ where: { key: { startsWith: 'jd-position-user:' } } })
  const jdPosition = new Map(jdRows.map((r) => [r.key.slice('jd-position-user:'.length), String((r.value as any)?.positionId ?? '')]))
  const rules = await db.rebateRule.findMany()
  const defaults = await settings()
  return list.map((u) => ({
    id: u.id,
    name: u.name,
    externalId: u.identities[0]?.externalUserId || '',
    channel: '企业微信',
    conversions: u._count.promotions,
    orders: u._count.orders,
    taobaoPid: (() => {
      const code = u.tracking.find((t) => t.accountId === TAOBAO_ACCOUNT)?.code
      return isAdzoneCode(code) ? userPid(taobao, code) || code : null
    })(),
    jdPosition: jdPosition.get(u.id) || null,
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
  // 喵有券第三方接入开启后：京东链接改由喵有券查券转链；淘宝链接走喵有券 + 官方混合转链（仍需官方凭证）
  const third =
    plugin.id === 'jd' ? await readConfig(ECAPI_KIND) : plugin.id === 'taobao' ? await readConfig(TB_ECAPI_KIND) : null
  const useThird = !!third && (plugin.id === 'jd' ? ecapiEnabled(third) : tbEcapiEnabled(third))
  if (!(useThird && plugin.id === 'jd') && !plugin.configured(c)) throw new BadRequestException('请先保存该平台的应用凭证')
  let trackingCode = ''
  let conf = c
  const notices: string[] = []
  if (userId) {
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user?.enabled) throw new BadRequestException('返现用户不存在或已禁用')
  }
  // 淘宝：每个用户用自己的推广位转链，订单回传的 adzone_id 即可精确关联用户；拿不到推广位时退回默认 PID（按商品匹配兜底）
  if (userId && plugin.id === 'taobao' && perUserAdzoneEnabled(c)) {
    try {
      const adzone = await ensureUserAdzone(dbAdzoneStore(), c, useThird ? third : null, userId)
      const pid = adzone ? userPid(c, adzone) : null
      if (adzone && pid) {
        trackingCode = adzone
        conf = { ...c, pid, adzoneId: adzone }
      }
    } catch (e) {
      notices.push(`用户专属推广位分配失败，已使用默认推广位：${(e as Error).message}`)
    }
  }
  // 京东：每个用户用推广位池里固定绑定的推广位转链，订单的 positionId 即可关联用户；池里没有空闲推广位时用默认推广位
  let thirdConf = third
  if (userId && plugin.id === 'jd') {
    const pool = parsePositionPool(c.positionPool, [c.positionId, third?.positionId])
    if (pool.length) {
      try {
        const positionId = await ensureUserPosition(dbPositionStore(), pool, userId)
        if (positionId) {
          conf = { ...c, positionId }
          if (third) thirdConf = { ...third, positionId }
        } else notices.push('京东推广位池已用完，已使用默认推广位')
      } catch (e) {
        notices.push(`用户专属推广位分配失败，已使用默认推广位：${(e as Error).message}`)
      }
    }
  }
  if (userId && plugin.id !== 'taobao') {
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
    const primary = async () => !useThird
      ? await plugin.convert(conf, url, trackingCode || undefined, content)
      : plugin.id === 'jd'
        ? await ecapiConvert(thirdConf!, url, trackingCode || undefined)
        : await tbHybridConvert(conf, third!, url, content)
    const { link, snapshot } = plugin.id === 'taobao'
      ? await withWebFallback(conf, primary, () => convertWeb(conf, content))
      : await primary()
    if (notices.length) snapshot.infoMessage = [...notices, snapshot.infoMessage].filter(Boolean).join('；')
    const rule = userId ? await db.rebateRule.findFirst({ where: { scopeKey: 'user:' + userId } }) : null
    const basisPoints = rule?.basisPoints ?? Math.round((await settings()).ratio * 100)
    snapshot.rebate =
      snapshot.commission === null ? null : Number((BigInt(snapshot.commission) * BigInt(basisPoints)) / 10000n)
    // 预计到手价 = 券后实付价，不再减去返现（返现单独展示）
    snapshot.finalPrice = snapshot.payablePrice != null ? Math.max(0, snapshot.payablePrice) : null
    await db.promotionRecord.update({
      where: { id: record.id },
      data: { status: 'SUCCESS', promotionUrl: link, productSnapshot: json(snapshot) },
    })
    await audit(actor, '商品转链', record.id, trace, { status: 'SUCCESS' })
    // 用户转链后 5 分钟内是下单高峰，立刻加快订单同步
    if (userId) wakeAutoSync()
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
export async function listOrders(platformId?: string) {
  const defaults = await settings()
  return (
    await db.affiliateOrder.findMany({
      where: platformId ? { platform: platformId } : {},
      include: { user: true, items: true },
      orderBy: { placedAt: 'desc' },
    })
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
      // 订单的推广位 ID（淘宝 adzone_id，京东 positionId），取自联盟原始订单数据
      positionId: positionIdOf(o.platform, o.rawData),
      product: o.items[0]?.title || '商品信息待确认',
      sku: o.items[0]?.sku || '',
      platform: ({ jd: '京东', taobao: '淘宝', pdd: '拼多多' } as Record<string, string>)[o.platform] || o.platform,
      user: o.user?.name || '未关联用户',
      userId: o.userId || '',
      attribution: o.userId ? (({ TRACKING: '联盟标识', PRODUCT: '按商品匹配', SIBLING: '同订单关联', MANUAL: '人工关联' }) as Record<string, string>)[o.attribution || ''] || '已关联' : '未关联',
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
      ...settlementOf(o.platform, o.rawData, currentStatus),
    }
  })
}
/** 订单原始数据里的推广位 ID；未返回时为 null */
function positionIdOf(platformId: string, raw: unknown) {
  const r = (raw || {}) as Record<string, unknown>
  const v = platformId === 'taobao' ? r.adzone_id : platformId === 'jd' ? r.positionId : null
  return v != null && /^[1-9]\d{0,19}$/.test(String(v)) ? String(v) : null
}
/** 佣金结算状态与结算时间；平台未提供时按订单状态推断（已取消为已失效） */
function settlementOf(platformId: string, raw: unknown, status: string) {
  const s = platform(platformId).orderSettlement?.(raw) ?? { state: status === 'CANCELLED' ? 'INVALID' : 'PENDING', settledAt: null }
  return { settlement: s.state, settledAt: s.settledAt }
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
