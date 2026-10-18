import { BadRequestException } from '@nestjs/common'
import { db, json } from './database'
import { readConfig } from './integrations'
import { platform, listPlatforms } from './platforms/registry'
import { notifyOrder, type OrderEvent } from './wecom'

type Cursor = {
  engine: 'platform-v1'
  platform: string
  from: string
  until: string
  next: string
  page: number
  count: number
  windows: number
  total: number
  type: 1 | 3
}
export async function startOrderSync(
  actor: string,
  trace: string,
  body: { platform?: string; hours?: number } = {},
  options: { auto?: boolean } = {},
) {
  const plugin = platform(body.platform || 'jd'),
    hours = body.hours ?? 24
  if (!Number.isInteger(hours) || hours < 1 || hours > plugin.maxHistoryDays * 24)
    throw new BadRequestException(`请选择 1 小时至 ${plugin.maxHistoryDays} 天的同步范围`)
  if (!plugin.configured(await readConfig(plugin.id))) throw new BadRequestException('请先在联盟配置中保存应用凭证')
  const until = new Date(),
    from = new Date(until.getTime() - hours * 3600000)
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73194713)`
    const running = await tx.syncJob.findFirst({
      where: {
        accountId: plugin.accountId,
        status: { in: ['QUEUED', 'RUNNING'] },
        cursor: { path: ['engine'], equals: 'platform-v1' },
      },
    })
    if (running) return { id: running.id, message: '已有同步任务，正在继续处理。' }
    const cursor: Cursor = {
      engine: 'platform-v1',
      platform: plugin.id,
      from: from.toISOString(),
      until: until.toISOString(),
      next: from.toISOString(),
      page: 1,
      count: 0,
      windows: 0,
      total: Math.ceil((until.getTime() - from.getTime()) / plugin.maxWindowMs),
      type: hours === 1 ? 3 : 1,
    }
    const job = await tx.syncJob.create({
      data: { accountId: plugin.accountId, cursor: json(cursor), status: 'QUEUED' },
    })
    if (!options.auto) await tx.auditLog.create({
      data: {
        actorId: actor,
        action: '开始同步订单',
        targetId: job.id,
        traceId: trace,
        diff: { platform: plugin.id, hours },
      },
    })
    return { id: job.id, message: '同步任务已开始，可离开页面，后台将分时段拉取。' }
  })
}
export async function orderSyncStatus() {
  const job = await db.syncJob.findFirst({
    where: { cursor: { path: ['engine'], equals: 'platform-v1' } },
    orderBy: { createdAt: 'desc' },
  })
  if (!job) return null
  const c = job.cursor as unknown as Cursor
  return {
    id: job.id,
    status: job.status,
    platform: c.platform,
    count: c.count,
    windows: c.windows,
    total: c.total,
    from: c.from,
    until: c.until,
    error: job.errorCode,
    finishedAt: job.finishedAt,
  }
}
let working = false
export async function processOrderSync() {
  if (working) return
  working = true
  try {
    const job = await db.syncJob.findFirst({
      where: {
        cursor: { path: ['engine'], equals: 'platform-v1' },
        OR: [{ status: 'QUEUED' }, { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 120000) } }],
      },
      orderBy: { createdAt: 'asc' },
    })
    if (!job) return
    const lease = new Date()
    const claim = await db.syncJob.updateMany({
      where: { id: job.id, updatedAt: job.updatedAt },
      data: { status: 'RUNNING', updatedAt: lease, startedAt: job.startedAt || lease, attempts: { increment: 1 } },
    })
    if (!claim.count) return
    try {
      const c = job.cursor as unknown as Cursor,
        plugin = platform(c.platform),
        from = new Date(c.next),
        until = new Date(Math.min(from.getTime() + plugin.maxWindowMs, new Date(c.until).getTime()))
      if (c.page > 10000) throw new BadRequestException('单时段分页超限，已停止；已导入数据保留')
      const page = await plugin.queryOrders(await readConfig(c.platform), { from, until, page: c.page, type: c.type })
      if (page.hasMore && !page.rows.length)
        throw new BadRequestException('平台返回空页但仍有下一页，已停止以免遗漏订单')
      const next: Cursor = {
        ...c,
        count: c.count + page.rows.length,
        page: page.hasMore ? c.page + 1 : 1,
        next: page.hasMore ? c.next : until.toISOString(),
        windows: c.windows + (page.hasMore ? 0 : 1),
      }
      const done = !page.hasMore && until.getTime() >= new Date(c.until).getTime()
      if (page.rows.length) console.log(`[订单同步] ${c.platform} ${from.toISOString()} 第 ${c.page} 页导入 ${page.rows.length} 条`)
      if (done) console.log(`[订单同步] ${c.platform} 同步完成，共 ${next.count} 条`)
      const events: OrderEvent[] = []
      await db.$transaction(
        async (tx) => {
          const held = await tx.syncJob.updateMany({
            where: { id: job.id, status: 'RUNNING', updatedAt: lease },
            data: {
              cursor: json(next),
              status: done ? 'COMPLETED' : 'QUEUED',
              finishedAt: done ? new Date() : null,
              errorCode: null,
            },
          })
          if (!held.count) return
          for (const row of page.rows) {
            const tracking = row.trackingCode
              ? await tx.userTrackingCode.findUnique({
                  where: { accountId_code: { accountId: plugin.accountId, code: row.trackingCode } },
                })
              : null
            const promotion = tracking
              ? await tx.promotionRecord.findFirst({
                  where: {
                    accountId: plugin.accountId,
                    trackingCode: tracking.code,
                    userId: tracking.userId,
                    status: 'SUCCESS',
                  },
                })
              : null
            const owner = promotion ? tracking!.userId : null
            const existing = await tx.affiliateOrder.findUnique({
              where: {
                platform_accountId_externalOrderId_externalLineId: {
                  platform: plugin.id,
                  accountId: plugin.accountId,
                  externalOrderId: row.orderId,
                  externalLineId: row.lineId,
                },
              },
              select: { userId: true, status: true },
            })
            if (owner && existing?.userId && owner !== existing.userId)
              throw new BadRequestException('订单用户标识冲突，已停止同步，请人工核对')
            const key = {
              platform: plugin.id,
              accountId: plugin.accountId,
              externalOrderId: row.orderId,
              externalLineId: row.lineId,
            }
            const common = {
              ...(owner ? { userId: owner } : {}),
              status: row.status,
              rawStatus: row.rawStatus,
              rawData: json(row.raw),
              commissionCents: row.commissionCents === null ? null : BigInt(row.commissionCents),
              completedAt: row.completedAt,
            }
            // 状态有变化（新订单或状态更新）时通知下单用户；只通知近期订单，避免同步历史时刷屏
            const notifyUser = owner || existing?.userId
            const recent = Date.now() - row.placedAt.getTime() < (existing ? 30 : 2) * 86400000
            if (notifyUser && recent && existing?.status !== row.status) {
              const kind = ({ CREATED: 'created', PAID: existing ? 'paid' : 'created', COMPLETED: 'completed', CANCELLED: 'cancelled' } as const)[
                row.status as 'CREATED' | 'PAID' | 'COMPLETED' | 'CANCELLED'
              ]
              if (kind)
                events.push({
                  userId: notifyUser,
                  kind,
                  platform: plugin.id,
                  title: row.title,
                  amountCents: row.commissionBaseCents,
                  commissionCents: row.commissionCents,
                })
            }
            await tx.affiliateOrder.upsert({
              where: { platform_accountId_externalOrderId_externalLineId: key },
              create: {
                ...key,
                ...common,
                placedAt: row.placedAt,
                items: {
                  create: {
                    sku: row.sku,
                    title: row.title,
                    quantity: row.quantity,
                    amountCents: BigInt(row.commissionBaseCents),
                  },
                },
              },
              update: {
                ...common,
                items: {
                  updateMany: {
                    where: { sku: row.sku },
                    data: { title: row.title, quantity: row.quantity, amountCents: BigInt(row.commissionBaseCents) },
                  },
                },
              },
            })
          }
        },
        { timeout: 30000 },
      )
      // 事务提交后再发通知，发送失败不影响同步
      for (const e of events) await notifyOrder(e).catch((err) => console.warn(`[企业微信] 订单通知发送失败：${err instanceof Error ? err.message : err}`))
    } catch (e) {
      console.warn(`[订单同步] 失败：${e instanceof Error ? e.message : e}`)
      await db.syncJob.updateMany({
        where: { id: job.id, status: 'RUNNING', updatedAt: lease },
        data: { status: 'FAILED', finishedAt: new Date(), errorCode: e instanceof Error ? e.message : '同步失败' },
      })
    }
  } finally {
    working = false
  }
}

/** 定时自动同步：每个已配置的联盟拉取最近 1 小时内有更新的订单（按更新时间），以便及时通知用户 */
export async function autoSyncOrders() {
  for (const plugin of listPlatforms()) {
    try {
      if (plugin.orderSync === false || !plugin.configured(await readConfig(plugin.id))) continue
      await startOrderSync('system', 'auto-sync', { platform: plugin.id, hours: 1 }, { auto: true })
    } catch (e) {
      console.warn(`[订单同步] ${plugin.name} 自动同步未启动：${e instanceof Error ? e.message : e}`)
    }
  }
}
