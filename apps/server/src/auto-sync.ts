import { db } from './database'
import { autoSyncOrders } from './order-sync'

const MIN = 60000

/** 最近转链活跃度：最后一次转链时间、近 2 小时转链的人数 */
export type Activity = { lastConversionAt: Date | null; activeUsers: number }

/**
 * 根据转链活跃度决定下一次自动同步订单的间隔：
 * 刚有人转链（很可能马上下单）时每分钟同步，下单后尽快通知；转链人很多时放宽到 2 分钟，避免触发联盟接口限频；
 * 长时间没人转链时逐步放慢到 30 分钟，节省接口调用。
 */
export function syncDelay(a: Activity, now = Date.now()) {
  if (!a.lastConversionAt) return 30 * MIN
  const idle = now - a.lastConversionAt.getTime()
  if (idle < 30 * MIN) return a.activeUsers >= 10 ? 2 * MIN : MIN
  if (idle < 2 * 60 * MIN) return 5 * MIN
  if (idle < 24 * 60 * MIN) return 15 * MIN
  return 30 * MIN
}

async function activity(): Promise<Activity> {
  const where = { status: 'SUCCESS', userId: { not: null } }
  const [last, users] = await Promise.all([
    db.promotionRecord.findFirst({ where, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    db.promotionRecord.findMany({
      where: { ...where, createdAt: { gte: new Date(Date.now() - 120 * MIN) } },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ])
  return { lastConversionAt: last?.createdAt ?? null, activeUsers: users.length }
}

let lastDelay = 0
/** 启动自动同步：首次在启动 1 分钟后执行，之后按活跃度动态安排下一次 */
export function startAutoSync() {
  const run = async () => {
    let delay = 30 * MIN
    try {
      await autoSyncOrders()
      const a = await activity()
      delay = syncDelay(a)
      if (delay !== lastDelay)
        console.info(`[订单同步] 自动同步间隔调整为 ${delay / MIN} 分钟（近 2 小时 ${a.activeUsers} 人转链）`)
      lastDelay = delay
    } catch {
      console.error('自动同步订单失败')
    }
    setTimeout(() => void run(), delay).unref()
  }
  setTimeout(() => void run(), MIN).unref()
}
