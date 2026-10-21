import { BadRequestException } from '@nestjs/common'
import { db, json } from './database'
import { readConfig } from './integrations'
import { platform, listPlatforms } from './platforms/registry'
import { notifyAdmin, notifyOrder, type OrderEvent } from './wecom'
import { dbPositionStore } from './platforms/jd/positions'
import { mergeTaobaoRaw } from './platforms/taobao/web-core'
import { normalizeTaobaoOrder } from './platforms/taobao/orders'
import { queryWebOrders } from './platforms/taobao/web'

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
  /** 当前时间段下一页的翻页位点（淘宝 position_index）；与订单在同一事务提交 */
  position?: string | null
  /** 自动同步生成的任务（定期清理） */
  auto?: boolean
  /** 网页任务固定来源，后续时段按自然日扫描，不与官方 20 分钟游标混用。 */
  web?: boolean
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
/**
 * 「下单成功」通知按「同一笔购买」去重的键：同用户、同平台、同商品、同下单时间。
 * 京东拆单会把已付款订单作废（无效-拆单）并生成新订单号，下单时间与商品不变，按订单行通知会重复推送。
 */
export const purchaseKey = (platform: string, userId: string, sku: string, placedAt: Date) =>
  `notify:created:${platform}:${userId}:${sku}:${placedAt.toISOString()}`
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
        from = new Date(c.next)
      const config = await readConfig(c.platform)
      let until = new Date(Math.min(from.getTime() + (c.web ? 86400000 : plugin.maxWindowMs), new Date(c.until).getTime()))
      if (c.page > 10000) throw new BadRequestException('单时段分页超限，已停止；已导入数据保留')
      const request = { from, until, page: c.page, type: c.type, position: c.position ?? null, webUntil: new Date(c.until) }
      const page = c.web ? await queryWebOrders(config, request) : await plugin.queryOrders(config, request)
      const web = c.web || page.source === 'taobao-web'
      if (web) {
        // 网页返回整个自然日。增量回溯已覆盖全部配置日期，不再重复执行三个 20 分钟分段。
        const lastDay = new Date(until.getTime() - 1 + 8 * 3600000).toISOString().slice(0, 10)
        until = c.type === 3 ? new Date(c.until) : new Date(Math.min(
          new Date(lastDay + 'T00:00:00+08:00').getTime() + 86400000, new Date(c.until).getTime(),
        ))
      }
      if (page.hasMore && !page.rows.length && !page.position?.startsWith('web:'))
        throw new BadRequestException('平台返回空页但仍有下一页，已停止以免遗漏订单')
      const next: Cursor = {
        ...c,
        ...(web ? { web: true, total: c.type === 3 ? c.windows + 1 : c.windows + 1 + Math.ceil((new Date(c.until).getTime() - until.getTime()) / 86400000) } : {}),
        count: c.count + page.rows.length,
        page: page.hasMore ? c.page + 1 : 1,
        position: page.hasMore ? (page.position ?? null) : null,
        next: page.hasMore ? c.next : until.toISOString(),
        windows: c.windows + (page.hasMore ? 0 : 1),
      }
      const done = !page.hasMore && until.getTime() >= new Date(c.until).getTime()
      if (page.rows.length) console.log(`[订单同步] ${c.platform} ${from.toISOString()} 第 ${c.page} 页导入 ${page.rows.length} 条`)
      if (done) console.log(`[订单同步] ${c.platform} 同步完成，共 ${next.count} 条`)
      const events: OrderEvent[] = []
      // 新入库、已付款却没有用户推广位标识的订单（用默认推广位或别人分享的链接下单），提醒管理员人工关联
      const unowned: string[] = []
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
            // 京东用户独立推广位：订单推广位 ID 绑定的用户，且该用户确实在京东转过链
            const positionUser =
              !promotion && plugin.id === 'jd' && row.positionId ? await dbPositionStore(tx).owner(row.positionId) : null
            const positionOwner =
              positionUser &&
              (await tx.promotionRecord.findFirst({ where: { accountId: plugin.accountId, userId: positionUser, status: 'SUCCESS' }, select: { id: true } }))
                ? positionUser
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
              select: { userId: true, status: true, attribution: true, rawData: true },
            })
            if (plugin.id === 'taobao' && existing?.rawData) {
              // 网页常缺商品 ID / 结算日期等字段；合并后重新计算金额，不能用 null 擦掉官方结果。
              Object.assign(row, normalizeTaobaoOrder(mergeTaobaoRaw(existing.rawData, row.raw)))
            }
            // 只按联盟回传的标识关联用户：京东 subUnionId / 用户推广位，淘宝用户推广位（adzone_id）。
            // 订单内容按联盟返回原样入库，不再按商品猜测用户，也不把同订单其他行挂到同一用户。
            const traced = promotion ? tracking!.userId : positionOwner
            // 旧版本按商品 / 同订单猜测的归属，以推广位为准纠正；联盟标识或人工关联的归属不覆盖
            const guessed = existing?.attribution === 'PRODUCT' || existing?.attribution === 'SIBLING'
            const owner = traced && (!existing?.userId || guessed || traced === existing.userId) ? traced : null
            if (promotion && !owner && existing?.userId) throw new BadRequestException('订单用户标识冲突，已停止同步，请人工核对')
            const key = {
              platform: plugin.id,
              accountId: plugin.accountId,
              externalOrderId: row.orderId,
              externalLineId: row.lineId,
            }
            const attribution = owner ? 'TRACKING' : undefined
            const common = {
              ...(owner ? { userId: owner, attribution } : {}),
              status: row.status,
              rawStatus: row.rawStatus,
              rawData: json(row.raw),
              commissionCents: row.commissionCents === null ? null : BigInt(row.commissionCents),
              completedAt: row.completedAt,
            }
            let pending: OrderEvent | null = null
            // 状态有变化（新订单或状态更新）时通知下单用户；只通知近期订单，避免同步历史时刷屏
            const notifyUser = owner || existing?.userId
            const recent = Date.now() - row.placedAt.getTime() < (existing ? 30 : 2) * 86400000
            // 金额和佣金都为 0 的订单行（赠品、非卖品）不单独通知，避免同一订单重复推送
            const gift = !row.commissionBaseCents && !row.commissionCents
            // 新关联上用户的订单（如先入库、后匹配到用户）即使状态没变也要通知一次
            const newlyOwned = !!owner && !existing?.userId
            if (notifyUser && recent && !gift && (newlyOwned || existing?.status !== row.status)) {
              const kind = orderEventKind(newlyOwned ? undefined : existing?.status, row.status)
              if (kind)
                pending = {
                  userId: notifyUser,
                  kind,
                  platform: plugin.id,
                  title: row.title,
                  // 付款金额：优先联盟的计佣金额，未付款时为 0 则用单价 × 数量
                  amountCents: row.commissionBaseCents || plugin.orderAmounts(row.raw).amount || null,
                  commissionCents: row.commissionCents,
                  imageUrl: plugin.orderImage(row.raw),
                  url: plugin.id === 'jd' && /^\d+$/.test(row.sku) ? `https://item.jd.com/${row.sku}.html` : null,
                }
            }
            const saved = await tx.affiliateOrder.upsert({
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
              select: { id: true },
            })
            if (pending?.kind === 'created') {
              // 同一笔购买只通知一次「下单成功」；记录在订单状态历史里，eventKey 唯一
              const eventKey = row.sku ? purchaseKey(plugin.id, pending.userId, row.sku, row.placedAt) : `notify:created:${saved.id}`
              if (await tx.orderStatusHistory.findUnique({ where: { eventKey }, select: { id: true } })) pending = null
              else await tx.orderStatusHistory.create({ data: { orderId: saved.id, status: row.status, rawStatus: row.rawStatus, eventKey } })
            }
            if (pending) events.push(pending)
            if (!existing && !owner && row.status === 'PAID' && !gift && Date.now() - row.placedAt.getTime() < 2 * 86400000)
              unowned.push(`${row.title.slice(0, 30)}｜订单 ${row.orderId}${row.positionId ? `｜推广位 ${row.positionId}` : ''}`)
          }
        },
        { timeout: 30000 },
      )
      // 事务提交后再发通知，发送失败不影响同步
      for (const e of events) await notifyOrder(e).catch((err) => console.warn(`[企业微信] 订单通知发送失败：${err instanceof Error ? err.message : err}`))
      if (unowned.length)
        await notifyAdmin([`📦 ${unowned.length} 笔新订单未关联用户（${plugin.name}）`, ...unowned.slice(0, 10), unowned.length > 10 ? `……另有 ${unowned.length - 10} 笔` : '', '订单未带用户推广位，请在后台订单列表人工关联。'].filter(Boolean).join('\n'))
          .catch((err) => console.warn(`[管理员通知] 未关联订单提醒未发送：${err instanceof Error ? err.message : err}`))
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
