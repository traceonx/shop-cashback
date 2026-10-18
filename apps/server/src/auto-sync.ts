import { db } from './database'
import { autoSyncOrders } from './order-sync'

const SEC = 1000
const MIN = 60 * SEC

/** 最近转链活跃度：最后一次转链时间、近 2 小时转链的人数 */
export type Activity = { lastConversionAt: Date | null; activeUsers: number }

/** 高峰期间隔：用户转链后 5 分钟内很可能下单，每 5 秒同步一次 */
export const PEAK_DELAY = 5 * SEC

/**
 * 根据转链活跃度决定下一次自动同步订单的间隔（毫秒）：
 * - 转链后 5 分钟内为高峰期：5 秒（转链人数 ≥10 时 10 秒，避免触发联盟接口限频），下单后尽快通知；
 * - 之后逐步放慢：30 分钟内 30 秒，2 小时内 60 秒，24 小时内 5 分钟，更久 10 分钟，节省接口调用。
 */
export function syncDelay(a: Activity, now = Date.now()) {
  if (!a.lastConversionAt) return 600 * SEC
  const idle = now - a.lastConversionAt.getTime()
  if (idle < 5 * MIN) return a.activeUsers >= 10 ? 10 * SEC : PEAK_DELAY
  if (idle < 30 * MIN) return 30 * SEC
  if (idle < 2 * 60 * MIN) return 60 * SEC
  if (idle < 24 * 60 * MIN) return 300 * SEC
  return 600 * SEC
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
let lastCleanup = 0
/** 自动同步每次都会生成一条任务记录，定期删掉 1 天前已完成的，避免表无限增长 */
async function cleanup() {
  if (Date.now() - lastCleanup < 60 * MIN) return
  lastCleanup = Date.now()
  await db.syncJob.deleteMany({
    where: { status: 'COMPLETED', cursor: { path: ['auto'], equals: true }, finishedAt: { lt: new Date(Date.now() - 24 * 60 * MIN) } },
  })
}
let timer: NodeJS.Timeout | null = null
let nextAt = 0
function schedule(delay: number) {
  if (timer) clearTimeout(timer)
  nextAt = Date.now() + delay
  timer = setTimeout(() => void run(), delay)
  timer.unref()
}
async function run() {
  timer = null
  let delay = 600 * SEC
  try {
    await autoSyncOrders()
    await cleanup().catch(() => undefined)
    const a = await activity()
    delay = syncDelay(a)
    if (delay !== lastDelay)
      console.info(`[订单同步] 自动同步间隔调整为 ${delay / SEC} 秒（近 2 小时 ${a.activeUsers} 人转链）`)
    lastDelay = delay
  } catch {
    console.error('自动同步订单失败')
  }
  schedule(delay)
}

/** 启动自动同步：首次在启动 1 分钟后执行，之后按活跃度动态安排下一次 */
export function startAutoSync() {
  schedule(MIN)
}

/** 用户转链成功后立刻进入高峰期：下一次同步提前到 5 秒内 */
export function wakeAutoSync() {
  if (!timer || nextAt - Date.now() <= PEAK_DELAY) return
  schedule(PEAK_DELAY)
}
