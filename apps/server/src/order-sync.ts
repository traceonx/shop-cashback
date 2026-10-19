import { BadRequestException } from '@nestjs/common'
import { db, json } from './database'
import { readConfig } from './integrations'
import { platform, listPlatforms } from './platforms/registry'
import { notifyOrder, type OrderEvent } from './wecom'
import { ownerBySku } from './attribution'

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
  /** 自动同步生成的任务（定期清理） */
  auto?: boolean
}
/**
 * 订单状态变化对应的用户通知：
 * 待付款不通知；付款后才算「下单成功」；已付款后取消才通知取消，未付款就关闭的订单不打扰用户。
 */
export function orderEventKind(prev: string | undefined, next: string): OrderEvent['kind'] | null {
  if (prev === next) return null
  if (next === 'PAID') return prev === 'COMPLETED' ? null : 'created'
  if (next === 'COMPLETED') return 'completed'
  if (next === 'CANCELLED') return prev === 'PAID' || prev === 'COMPLETED' ? 'cancelled' : null
  return null
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
      ...(options.auto ? { auto: true } : {}),
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
/** 手动同步未指定平台时：对所有已接入订单同步且已配置凭证的平台各开一个任务 */
export async function startAllOrderSync(actor: string, trace: string, hours?: number) {
  const started: string[] = [],
    skipped: string[] = []
  for (const plugin of listPlatforms()) {
    if (plugin.orderSync === false || !plugin.configured(await readConfig(plugin.id))) {
      skipped.push(plugin.name)
      continue
    }
    await startOrderSync(actor, trace, { platform: plugin.id, hours })
    started.push(plugin.name)
  }
  if (!started.length) throw new BadRequestException('没有可同步订单的联盟，请先在联盟配置中保存应用凭证')
  return { message: `已开始同步${started.join('、')}订单，可离开页面，后台将分时段拉取。${skipped.length ? `（${skipped.join('、')}未配置，已跳过）` : ''}` }
}
export async function orderSyncStatus(platformId?: string) {
  const scope = platformId ? { AND: [{ cursor: { path: ['engine'], equals: 'platform-v1' } }, { cursor: { path: ['platform'], equals: platformId } }] } : { cursor: { path: ['engine'], equals: 'platform-v1' } }
  // 多个平台同时同步时优先展示进行中或失败的任务
  const job =
    (await db.syncJob.findFirst({
      where: { ...scope, status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'asc' },
    })) ||
    (await db.syncJob.findFirst({
      where: scope,
      orderBy: { createdAt: 'desc' },
    }))
  if (!job) return null
  const c = job.cursor as unknown as Cursor
  const last = await db.syncJob.findFirst({
    where: { ...scope, status: 'COMPLETED' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  })
  return {
    auto: !!c.auto,
    lastSyncedAt: last?.finishedAt ?? null,
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
/** 后台同步：每次被定时器唤起后连续处理多个时段（最多约 20 秒），而不是每 2 秒只处理一个 */
export async function processOrderSync() {
  if (working) return
  working = true
  try {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline && (await processOrderStep())) {
      await new Promise((r) => setTimeout(r, 200)) // 稍作间隔，避免触发联盟接口频率限制
    }
  } finally {
    working = false
  }
}
/** 处理一页订单；没有待处理任务时返回 false */
async function processOrderStep(): Promise<boolean> {
  {
    const job = await db.syncJob.findFirst({
      where: {
        cursor: { path: ['engine'], equals: 'platform-v1' },
        OR: [{ status: 'QUEUED' }, { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 120000) } }],
      },
      orderBy: { createdAt: 'asc' },
    })
    if (!job) return false
    const lease = new Date()
    const claim = await db.syncJob.updateMany({
      where: { id: job.id, updatedAt: job.updatedAt },
      data: { status: 'RUNNING', updatedAt: lease, startedAt: job.startedAt || lease, attempts: { increment: 1 } },
    })
    if (!claim.count) return false
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
            // 优先用联盟回传的用户标识；未回传时按「下单前谁转过这个商品」匹配，仅唯一时关联
            const owner = promotion
              ? tracking!.userId
              : existing?.userId
                ? null
                : await ownerBySku(tx, plugin.accountId, row.sku, row.placedAt, plugin.id === 'taobao' ? row.title : undefined)
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
            // 金额和佣金都为 0 的订单行（赠品、非卖品）不单独通知，避免同一订单重复推送
            const gift = !row.commissionBaseCents && !row.commissionCents
            if (notifyUser && recent && !gift && existing?.status !== row.status) {
              const kind = orderEventKind(existing?.status, row.status)
              if (kind)
                events.push({
                  userId: notifyUser,
                  kind,
                  platform: plugin.id,
                  title: row.title,
                  // 付款金额：优先联盟的计佣金额，未付款时为 0 则用单价 × 数量
                  amountCents: row.commissionBaseCents || plugin.orderAmounts(row.raw).amount || null,
                  commissionCents: row.commissionCents,
                  imageUrl: plugin.orderImage(row.raw),
                  url: plugin.id === 'jd' && /^\d+$/.test(row.sku) ? `https://item.jd.com/${row.sku}.html` : null,
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
          // 同一订单号的其他订单行（赠品、凑单商品等）未关联时，跟随已关联的订单行归属同一用户；
          // 订单行之间用户不一致时不处理，留待人工核对
          for (const orderId of new Set(page.rows.map((r) => r.orderId))) {
            const where = { platform: plugin.id, accountId: plugin.accountId, externalOrderId: orderId }
            const owners = await tx.affiliateOrder.findMany({ where: { ...where, userId: { not: null } }, select: { userId: true }, distinct: ['userId'], take: 2 })
            if (owners.length === 1) await tx.affiliateOrder.updateMany({ where: { ...where, userId: null }, data: { userId: owners[0].userId } })
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
      return false
    }
    return true
  }
}

/** 定时自动同步：每个已配置的联盟拉取最近 1 小时内有更新的订单（按更新时间），以便及时通知用户 */
/**
 * 立即同步最近 1 小时的订单并等待完成（用户查看「全部订单」时调用），最多等待 timeoutMs；
 * 已有同步任务在跑时会等它结束。返回是否在时限内完成。
 */
export async function syncOrdersNow(timeoutMs = 8000) {
  await autoSyncOrders()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await processOrderSync()
    const pending = await db.syncJob.count({
      where: { status: { in: ['QUEUED', 'RUNNING'] }, cursor: { path: ['engine'], equals: 'platform-v1' } },
    })
    if (!pending) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}
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
