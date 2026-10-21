import { db, json } from './database'

/**
 * 给管理员单独发系统提醒（企业微信「渠道配置 → 管理员通知 UserID」绑定的成员）。
 * 同一类提醒在冷却时间内只发一次，避免每次转链都刷屏；未配置管理员或发送失败只记日志，不影响业务。
 */
export async function alertAdmin(key: string, content: string, cooldownMs = 6 * 3600000) {
  const id = `admin-alert:${key}`
  try {
    const now = Date.now()
    const row = await db.systemConfig.findUnique({ where: { key: id } })
    const last = Number((row?.value as { at?: number } | null)?.at) || 0
    if (now - last < cooldownMs) return false
    // 先占位再发送：并发转链时只有一个请求能更新成功
    const claimed = row
      ? (await db.systemConfig.updateMany({ where: { key: id, updatedAt: row.updatedAt }, data: { value: json({ at: now }) } })).count > 0
      : await db.systemConfig.create({ data: { key: id, value: json({ at: now }) } }).then(() => true, () => false)
    if (!claimed) return false
    try {
      const { notifyAdmin } = await import('./wecom')
      await notifyAdmin(content)
    } catch (e) {
      // 发送失败释放冷却，下次还会再试
      await db.systemConfig.update({ where: { key: id }, data: { value: json({ at: last }) } }).catch(() => undefined)
      throw e
    }
    return true
  } catch (e) {
    console.warn(`[管理员通知] ${key} 未发送：${e instanceof Error ? e.message : e}`)
    return false
  }
}
