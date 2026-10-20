import { randomUUID } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { db } from '../../database'
import { encrypt, decrypt } from '../../security'
import { readConfig } from '../../integrations'
import type { PlatformConfig, PlatformOrder } from '../types'
import { WebError, webResponse, webConversion, webOrder, webHasNext, validateCookies, fallbackAllowed, applyWebResult, type WebState } from './web-core'

const KEY = 'taobao-web-session'
const LOCK = 73194729
type State = {
  state: WebState; cookie?: string; generation?: string; lastValid?: number; expiredAt?: number;
  incident?: string; notified?: boolean; attempts?: number; retryAt?: number;
  nextAt?: number; lease?: string; leaseUntil?: number;
  lastProbe?: number; account?: string;
  userAgent?: string; lastError?: string; connecting?: string;
}
// 所有实例共享数据库锁、请求间隔与租约；请求期间不占数据库事务。
async function mutate<T>(fn: (s: State) => Promise<T> | T): Promise<T> {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK})`)
    const row = await tx.systemConfig.findUnique({ where: { key: KEY } })
    const s = row ? decrypt<State>((row.value as any).encrypted, KEY) : { state: 'NONE' as const }
    const result = await fn(s)
    const value = { encrypted: encrypt(s, KEY) }
    await tx.systemConfig.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } })
    return result
  }, { timeout: 20000 })
}
export async function webStatus() {
  return mutate(s => ({
    state: s.state, lastValid: s.lastValid ?? null, expiredAt: s.expiredAt ?? null,
    account: s.account ?? null, lastError: s.lastError || null,
    notification: s.incident ? (s.notified ? 'SENT' : (s.attempts || 0) >= 3 ? 'FAILED' : 'PENDING') : null,
  }))
}
/** 仅由服务端独立浏览器调用，不提供客户端导入 Cookie 的公开接口。验证通过后再替换旧会话。 */
export async function connectWebLogin(cookies: unknown, userAgent: string, stillCurrent: () => boolean = () => true) {
  const cookie = validateCookies(cookies)
  if (!userAgent || userAgent.length > 512 || /[\r\n]/.test(userAgent)) throw new BadRequestException('浏览器标识无效')
  const c = await readConfig('taobao')
  const account = /^mm_(\d+)_/.exec(c.pid || '')?.[1]
  if (!account) throw new BadRequestException('请先保存默认推广位 PID')
  const connecting = randomUUID()
  await mutate(s => { s.connecting = connecting })
  try {
    const d = day(new Date())
    await requestWeb('report.getTbkOrderDetails', orderParams(d, d), true, { cookie, userAgent })
    const latest = await readConfig('taobao')
    if (account !== /^mm_(\d+)_/.exec(latest.pid || '')?.[1]) throw new WebError('VERIFY', '登录期间 PID 账号已变更，请重新登录')
    await mutate(s => {
      if (s.connecting !== connecting || !stillCurrent()) throw new BadRequestException('登录已取消，请重新登录')
      Object.assign(s, { cookie, userAgent, account, generation: randomUUID(), connecting: undefined, lastError: undefined })
      applyWebResult(s, undefined, Date.now(), '')
    })
  } catch (e) {
    await mutate(s => {
      if (s.connecting === connecting) {
        s.connecting = undefined
        s.lastError = e instanceof WebError ? e.message : '新登录会话未通过验证，请重试'
      }
    })
    throw e
  }
  return webStatus()
}
export async function disconnectWeb() {
  await mutate(s => { for (const k of Object.keys(s)) delete (s as any)[k]; s.state = 'NONE' })
}
export function webMode(c: PlatformConfig) { return c.webMode || 'off' }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
async function requestWeb(endpoint: 'report.getTbkOrderDetails' | 'xt.entry', params: Record<string, string>, verify = false, candidate?: { cookie: string; userAgent: string }) {
  const c = await readConfig('taobao')
  if (webMode(c) === 'off' && !verify) throw new WebError('NONE', '淘宝网页备用通道未启用')
  const rpm = Math.min(20, Math.max(1, Number(c.webRpm) || 20))
  const deadline = Date.now() + Math.max(35000, Math.ceil(60000 / rpm) + 5000)
  let ticket: { cookie: string; lease: string; generation: string; userAgent: string } | null = null
  while (!ticket && Date.now() < deadline) {
    ticket = await mutate(s => {
      if (!candidate && (!s.cookie || !s.generation || (!verify && ['NONE', 'PENDING', 'EXPIRED', 'VERIFY'].includes(s.state))))
        throw new WebError(s.state, '淘宝网页会话不可用，请在联盟配置重新登录')
      if (!candidate && s.account !== /^mm_(\d+)_/.exec(c.pid || '')?.[1]) throw new WebError('VERIFY', '默认 PID 账号已变更，请重新登录')
      const now = Date.now()
      if ((s.nextAt || 0) > now || (s.leaseUntil || 0) > now) return null
      s.lease = randomUUID(); s.leaseUntil = now + 30000; s.nextAt = now + Math.ceil(60000 / rpm)
      return { cookie: candidate?.cookie || s.cookie!, lease: s.lease, generation: s.generation || '',
        userAgent: candidate?.userAgent || s.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' }
    })
    if (!ticket) await wait(300)
  }
  if (!ticket) throw new WebError('LIMITED', '淘宝网页备用通道繁忙，请稍后重试')
  let error: WebError | undefined
  try {
    const token = /(?:^|; )_tb_token_=([^;]+)/.exec(ticket.cookie)?.[1]
    if (!token) throw new WebError('EXPIRED', '淘宝网页登录凭证缺失')
    const q = new URLSearchParams({ ...params, t: String(Date.now()), _tb_token_: token })
    const r = await fetch(`https://pub.alimama.com/openapi/param2/1/gateway.unionpub/${endpoint}.json?${q}`, {
      headers: { Cookie: ticket.cookie, Accept: 'application/json', 'bx-v': '2.5.11',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: endpoint === 'xt.entry' ? 'https://pub.alimama.com/portal/v2/tool/links/page/home/index.htm' : 'https://pub.alimama.com/portal/v2/effect/order/overviewOrder/page/index.htm',
        'User-Agent': ticket.userAgent },
      redirect: 'manual', signal: AbortSignal.timeout(20000),
    })
    const d = webResponse(r.status, await r.text(), r.headers.get('location') || '')
    if (endpoint === 'report.getTbkOrderDetails') {
      if (!Array.isArray(d.result)) throw new WebError('FORMAT', '订单列表格式异常，已停止同步')
      // 有订单时核对联盟账号；空订单无法证明身份，不据此强行认领任何订单。
      if (d.result.some((row: any) => row.pubId != null && String(row.pubId) !== /^mm_(\d+)_/.exec(c.pid || '')?.[1]))
        throw new WebError('VERIFY', '登录账号与配置 PID 不匹配，请切换淘宝账号')
    }
    return d
  } catch (e) {
    error = e instanceof WebError ? e : new WebError('NETWORK', '淘宝网页请求网络失败或超时')
    throw error
  } finally {
    await mutate(s => {
      if (s.lease !== ticket!.lease) return
      s.leaseUntil = 0; s.lease = undefined; s.lastProbe = Date.now()
      if (candidate || s.generation !== ticket!.generation) return
      applyWebResult(s, error?.kind, Date.now(), randomUUID())
      s.lastError = error?.message
    })
  }
}
const day = (d: Date) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10)
const orderParams = (from: string, until: string, page = 1, position = '') => ({
  pageNo: String(page), pageSize: '20', startTime: from, endTime: until, payStatus: '', queryType: '2',
  jumpType: page === 1 ? '0' : '1', tkTradeId: '', positionIndex: position,
})
export async function webProbe(force = false) {
  const d = day(new Date())
  await requestWeb('report.getTbkOrderDetails', orderParams(d, d), force)
}
export async function convertWeb(c: PlatformConfig, content: string) {
  if (!/^mm_\d+_\d+_\d+$/.test(c.pid || '') || c.pid.split('_')[3] !== c.adzoneId)
    throw new BadRequestException('推广位 PID 与推广位 ID 不一致，已停止备用转链')
  return webConversion(await requestWeb('xt.entry', {
    floorId: '61446', refpid: c.pid,
    variableMap: JSON.stringify({ url: content, superRedSwitch: '0', lensScene: 'PUB', spmB: '_portal_v2_tool_links_page_home_index_htm' }),
  }))
}
export async function withWebFallback<T>(c: PlatformConfig, primary: () => Promise<T>, backup: () => Promise<T>): Promise<T> {
  if (webMode(c) === 'manual') return backup()
  try { return await primary() } catch (e) {
    if (webMode(c) !== 'auto' || !fallbackAllowed(e)) throw e
    const s = await webStatus()
    if (['NONE', 'PENDING', 'EXPIRED', 'VERIFY'].includes(s.state)) throw e
    return backup()
  }
}
type Cursor = { from: string; until: string; day: string; page: number; position: string }
export async function queryWebOrders(c: PlatformConfig, req: { from: Date; until: Date; page: number; type: 1 | 3; position?: string | null; webUntil?: Date }) {
  // 网页 queryType=2 的时间口径不能冒充官方更新时间查询：增量同步保守重扫回溯范围。
  // 每次只请求一天，分页游标与查询范围一起持久化，避免跨源混用。
  let cursor: Cursor
  if (req.position?.startsWith('web:')) {
    try { cursor = JSON.parse(Buffer.from(req.position.slice(4), 'base64url').toString()) } catch { throw new BadRequestException('网页订单游标损坏') }
  } else {
    const until = req.type === 3 ? req.webUntil || req.until : req.until
    const from = req.type === 3 ? new Date(until.getTime() - (Math.min(90, Math.max(1, Number(c.webLookbackDays) || 90)) - 1) * 86400000) : req.from
    const end = day(new Date(until.getTime() - 1))
    cursor = { from: day(from), until: end, day: end, page: 1, position: '' }
  }
  const d = await requestWeb('report.getTbkOrderDetails', orderParams(cursor.day, cursor.day, cursor.page, cursor.position))
  if (d.pageNo != null && Number(d.pageNo) !== cursor.page) throw new WebError('FORMAT', '网页订单返回页码不一致')
  const rows: PlatformOrder[] = d.result.map(webOrder)
  const more = webHasNext(d, cursor.page)
  if (more) {
    const next = String(d.positionIndex || '')
    if (!next || next === cursor.position) throw new WebError('FORMAT', '网页订单翻页位点缺失或重复')
    cursor.page++; cursor.position = next
  } else {
    cursor.day = new Date(new Date(cursor.day + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10)
    cursor.page = 1; cursor.position = ''
  }
  const hasMore = more || cursor.day >= cursor.from
  return { rows, hasMore, position: hasMore ? 'web:' + Buffer.from(JSON.stringify(cursor)).toString('base64url') : null, source: 'taobao-web' }
}
export async function webMaintenance() {
  const c = await readConfig('taobao')
  if (webMode(c) === 'off') return
  const probe = await mutate(s => {
    if (!s.cookie || ['NONE', 'PENDING', 'EXPIRED', 'VERIFY'].includes(s.state)) return false
    if (Date.now() - (s.lastProbe || 0) < Math.max(5, Number(c.webHealthMinutes) || 15) * 60000) return false
    s.lastProbe = Date.now()
    return true
  })
  if (probe) await webProbe().catch(() => undefined)
  // 原子保留一次尝试，跨实例不会同时发送；外部调用不占数据库事务。
  const event = await mutate(s => {
    if (!s.incident || s.notified || (s.attempts || 0) >= 3 || (s.retryAt || 0) > Date.now()) return null
    s.attempts = (s.attempts || 0) + 1; s.retryAt = Date.now() + 5 * 60000
    return { incident: s.incident, account: s.account, expiredAt: s.expiredAt }
  })
  if (!event) return
  try {
    const { notifyAdmin } = await import('../../wecom')
    let base = c.publicUrl || process.env.PUBLIC_BASE_URL || ''
    try {
      const u = new URL(base)
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) base = ''
    } catch { base = '' }
    await notifyAdmin(`淘宝联盟网页登录已失效\n联盟账号：${event.account || '未确认'}\n检测时间：${new Date(event.expiredAt!).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n网页备用转链和订单查询已暂停，主通道仍按原配置运行。\n请在联盟配置重新登录。${base ? `\n${base}/affiliates` : ''}\n事件：${event.incident}`)
    await mutate(s => { if (s.incident === event.incident) s.notified = true })
  } catch { /* 不记录凭证或上游响应；下次维护有限重试 */ }
}
