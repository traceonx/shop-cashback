import { createHash, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { db, dateText } from './database'
import { readConfig, wecomToken, wecomUrl, wecomError, type Config } from './integrations'
import { convert, settings } from './business'
import { menuCommand } from './wecom-menu'
import { listPlatforms } from './platforms/registry'
export function decryptCallback(c: Config, signature: string, timestamp: string, nonce: string, encrypted: string) {
  if (!c.token || !c.aesKey || !c.corpId) throw new BadRequestException('请先配置企业微信回调参数')
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !nonce || nonce.length > 128)
    throw new UnauthorizedException('回调已过期或参数无效')
  const expected = createHash('sha1').update([c.token, timestamp, nonce, encrypted].sort().join('')).digest('hex')
  if (
    !/^[a-f0-9]{40}$/i.test(signature) ||
    !timingSafeEqual(Buffer.from(signature.toLowerCase()), Buffer.from(expected))
  )
    throw new UnauthorizedException('回调签名无效')
  try {
    const key = Buffer.from(c.aesKey + '=', 'base64')
    if (key.length !== 32) throw new Error()
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16))
    decipher.setAutoPadding(false)
    const padded = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()])
    const pad = padded[padded.length - 1]
    if (pad < 1 || pad > 32 || !padded.subarray(-pad).every((n) => n === pad)) throw new Error()
    const data = padded.subarray(0, -pad)
    if (data.length < 20) throw new Error()
    const len = data.readUInt32BE(16)
    if (len > data.length - 20) throw new Error()
    if (data.subarray(20 + len).toString() !== c.corpId) throw new Error()
    return data.subarray(20, 20 + len).toString('utf8')
  } catch {
    throw new UnauthorizedException('回调解密或接收企业校验失败')
  }
}
export function xmlObject(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || text.length > 65536) throw new BadRequestException('不支持的 XML')
  return new XMLParser({ ignoreAttributes: true, parseTagValue: false, processEntities: false }).parse(text).xml
}
export async function receiveCallback(query: Record<string, string>, body: string) {
  const c = await readConfig('wecom')
  const envelope = xmlObject(body),
    plain = decryptCallback(
      c,
      query.msg_signature || '',
      query.timestamp || '',
      query.nonce || '',
      String(envelope?.Encrypt || ''),
    )
  const msg = xmlObject(plain)
  if (msg.ToUserName !== c.corpId || String(msg.AgentID) !== c.agentId)
    throw new UnauthorizedException(`回调应用不匹配（AgentID ${msg.AgentID}，配置为 ${c.agentId}）`)
  if (c.enabled === 'false') return // 渠道已停用：验签通过但不处理消息
  const event = msg.MsgType === 'event' && String(msg.Event).toLowerCase() === 'click'
  if (msg.MsgType !== 'text' && !event) return
  const content = event ? menuCommand(String(msg.EventKey || '')) : String(msg.Content || '')
  if (content === null) return
  const sender = String(msg.FromUserName || ''),
    externalId = event ? `event:${createHash('sha256').update(plain).digest('hex')}` : String(msg.MsgId || '')
  if (!sender || !externalId) throw new BadRequestException('消息身份缺失')
  await db.incomingMessage.upsert({
    where: { channelId_externalId: { channelId: 'wecom-primary', externalId } },
    create: {
      channelId: 'wecom-primary',
      externalId,
      status: 'PENDING',
      payload: { sender, content },
      nextAttemptAt: new Date(),
    },
    update: {},
  })
}
type News = { title: string; description: string; url: string; picurl?: string; followup?: string }
// 按 UTF-8 字节截断（企业微信图文：标题 ≤128 字节，描述 ≤512 字节）
function clip(text: string, bytes: number) {
  if (Buffer.byteLength(text) <= bytes) return text
  let out = ''
  for (const ch of text) {
    if (Buffer.byteLength(out + ch + '…') > bytes) break
    out += ch
  }
  return out + '…'
}
async function send(c: Config, user: string, content: string | News) {
  const token = await wecomToken(c)
  const body =
    typeof content === 'string'
      ? { msgtype: 'text', text: { content } }
      : {
          msgtype: 'news',
          news: {
            articles: [
              {
                title: clip(content.title, 128),
                description: clip(content.description, 512),
                url: content.url,
                ...(content.picurl ? { picurl: content.picurl } : {}),
              },
            ],
          },
        }
  const r = await fetch(wecomUrl(c, `cgi-bin/message/send?access_token=${encodeURIComponent(token)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ touser: user, agentid: Number(c.agentId), ...body }),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  })
  const data = (await r.json()) as any
  if (!r.ok || data.errcode !== 0 || data.invaliduser)
    throw new Error(data.invaliduser ? `接收人无效：${data.invaliduser}` : wecomError('消息发送失败', data))
}
export async function notifyAdmin(content: string) {
  const c = await readConfig('wecom')
  if (c.enabled === 'false' || !c.corpId || !c.secret || !c.agentId || !c.adminUserId ||
    c.adminUserId === '@all' || /[|,;]/.test(c.adminUserId))
    throw new Error('请配置一个有效的企业微信管理员 UserID')
  await send(c, c.adminUserId, content)
}
const yuan = (cents: number | null | undefined) => (cents == null ? '待确认' : `¥${(cents / 100).toFixed(2)}`)

export type OrderEvent = {
  userId: string
  kind: 'created' | 'completed' | 'cancelled'
  platform: string
  title: string
  amountCents: number | null
  commissionCents: number | null
  imageUrl?: string | null
  url?: string | null
  /** 按商品匹配关联的订单（无联盟回传标识），提醒用户核对 */
  matched?: boolean
}
const platformName: Record<string, string> = { jd: '京东', taobao: '淘宝' }
const orderHead = {
  created: '✅ 下单成功，已记录返利',
  completed: '🎉 订单已完成，返现进入待结算',
  cancelled: '❌ 订单已取消，本单不产生返现',
}
/** 拆出标题末尾的【标签】，如「皇家猫粮…3.5KG【宠物金选】」→ 标题 + 「宠物金选」 */
export function splitTitle(title: string) {
  const m = /^(.*?)\s*【([^】]{1,20})】\s*$/.exec(title)
  return m ? { name: m[1], tag: m[2] } : { name: title, tag: '' }
}
/**
 * 订单通知：图文消息（商品图 + 标题 + 明细），个人微信里的企业微信插件也能正常显示。
 * 注意：模板卡片（template_card）在微信插件中不显示，接口却返回成功，所以不用。
 */
export function orderNews(e: OrderEvent, rebate: number, total: number): News {
  const cancelled = e.kind === 'cancelled'
  // 取消的订单只显示商品、平台和累计返利；其他状态显示付款金额与本单返现
  const lines = [
    e.title,
    `平台：${platformName[e.platform] || e.platform}`,
    !cancelled && e.amountCents ? `付款金额：${yuan(e.amountCents)}` : null,
    cancelled ? null : `本单返现：${yuan(rebate)}`,
    `累计返利：${yuan(total)}`,
    e.matched ? '按你转过的商品自动匹配，如不是你的订单请回复说明' : null,
  ].filter(Boolean)
  return {
    title: orderHead[e.kind],
    description: lines.join('\n'),
    url: e.url || 'https://www.jd.com',
    ...(e.imageUrl ? { picurl: e.imageUrl } : {}),
  }
}
/** 「我的返现账户」文本：企业微信文本消息不支持样式，用图标 + 对齐排版 */
export function accountText(a: { available: number; pending: number; frozen: number; withdrawn: number }) {
  const row = (icon: string, label: string, cents: number) => `${icon} ${label.padEnd(4, '\u3000')}  ${yuan(cents)}`
  return [
    '💼 我的返现账户',
    '────────────',
    row('💰', '可提现', a.available),
    row('📄', '待结算', a.pending),
    row('❄️', '冻结', a.frozen),
    row('📊', '累计提现', a.withdrawn),
  ].join('\n')
}
/** 用户当前累计返利（未取消订单的预计返现之和，比例优先取下单快照） */
async function totalRebate(userId: string, basisPoints: number, unsettledOnly = false) {
  const orders = await db.affiliateOrder.findMany({
    where: { userId },
    select: { platform: true, status: true, rawStatus: true, rawData: true, commissionCents: true, rebateCents: true, ruleSnapshot: true },
  })
  let sum = 0
  for (const o of orders) {
    const plugin = listPlatforms().find((p) => p.id === o.platform)
    const status = o.status === 'UNATTRIBUTED' && plugin ? plugin.orderStatus(o.rawStatus || '') : o.status
    // 已取消、未付款的订单不计入返利
    if (status === 'CANCELLED' || status === 'CREATED') continue
    if (o.rebateCents != null) {
      if (!unsettledOnly) sum += Number(o.rebateCents)
      continue
    }
    const commission = plugin?.orderAmounts(o.rawData).commission ?? (o.commissionCents == null ? null : Number(o.commissionCents))
    const bp = (o.ruleSnapshot as { basisPoints?: number } | null)?.basisPoints ?? basisPoints
    if (commission != null) sum += Math.floor((commission * bp) / 10000)
  }
  return sum
}
/** 订单状态变化时通知下单用户；未启用企业微信或用户无企业微信身份时跳过 */
export async function notifyOrder(e: OrderEvent) {
  const wecom = await readConfig('wecom')
  if (wecom.enabled === 'false' || !wecom.corpId || !wecom.secret || !wecom.agentId) return
  const identity = await db.userIdentity.findFirst({ where: { userId: e.userId, channelId: 'wecom-primary' } })
  if (!identity) return
  const rule = await db.rebateRule.findFirst({ where: { scopeKey: 'user:' + e.userId } })
  const basisPoints = rule?.basisPoints ?? Math.round((await settings()).ratio * 100)
  const rebate = e.commissionCents == null ? 0 : Math.floor((e.commissionCents * basisPoints) / 10000)
  const total = await totalRebate(e.userId, basisPoints)
  await send(wecom, identity.externalUserId, orderNews(e, rebate, total))
  console.log(`[企业微信] 已通知 ${identity.externalUserId}：${orderHead[e.kind]}`)
}
let running = false
export async function processInbox() {
  if (running) return
  running = true
  try {
    const message = await db.incomingMessage.findFirst({
      where: {
        nextAttemptAt: { lte: new Date() },
        attempts: { lt: 5 },
        OR: [{ status: 'PENDING' }, { status: 'PROCESSING', lockedUntil: { lt: new Date() } }],
      },
      orderBy: { receivedAt: 'asc' },
    })
    if (!message) return
    const claim = await db.incomingMessage.updateMany({
      where: { id: message.id, status: message.status, attempts: message.attempts },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, lockedUntil: new Date(Date.now() + 120000) },
    })
    if (!claim.count) return
    try {
      const { sender, content } = message.payload as { sender: string; content: string }
      let identity = await db.userIdentity.findUnique({
        where: { channelId_externalUserId: { channelId: message.channelId, externalUserId: sender } },
        include: { user: true },
      })
      if (!identity) {
        try {
          identity = await db.userIdentity.create({
            data: {
              channel: { connect: { id: message.channelId } },
              externalUserId: sender,
              user: { create: { name: sender, wallet: { create: {} } } },
            },
            include: { user: true },
          })
        } catch {
          identity = await db.userIdentity.findUnique({
            where: { channelId_externalUserId: { channelId: message.channelId, externalUserId: sender } },
            include: { user: true },
          })
        }
      }
      if (!identity) throw new Error('IDENTITY_CREATE_FAILED')
      const id = identity.userId
      let reply: string | News = '发送商品链接查询优惠和预计返现。\n/订单 查看自己的订单\n/待结算 查看待结算订单\n/余额 查看账户金额\n/提现记录 查看提现进度\n订单同步可能有延迟；取消或退款会影响返现。'
      if (!identity.user.enabled) reply = '当前账户已禁用，请联系管理员。'
      else if (content.trim() === '/查返利') reply = '直接发送京东、淘宝 / 天猫商品链接或含链接的分享文案，即可查询优惠与预计返现。价格和优惠以实际下单为准。'
      else if (content.trim() === '/支持平台') reply = `当前已接入：${listPlatforms().map((p) => p.name).join('、')}。\n直接发送商品链接或分享文案即可查询优惠与返现。各平台可用性取决于实际接口权限。`
      else if (content.trim() === '/余额') {
        const w = await db.walletAccount.findUnique({ where: { userId: id } })
        const rule = await db.rebateRule.findFirst({ where: { scopeKey: 'user:' + id } })
        // 待结算 = 钱包里待结算金额 + 尚未入账订单的预计返现（已取消的不算）
        const pending = Number(w?.pendingCents || 0n) + (await totalRebate(id, rule?.basisPoints ?? Math.round((await settings()).ratio * 100), true))
        reply = accountText({
          available: Number(w?.availableCents || 0n),
          pending,
          frozen: Number(w?.frozenCents || 0n),
          withdrawn: Number(w?.withdrawnCents || 0n),
        })
        const entries = w ? await db.walletTransaction.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'desc' }, take: 5 }) : []
        reply += entries.length
          ? '\n\n最近流水\n' + entries.map((entry) => `${entry.reason}  ${entry.deltaCents > 0n ? '+' : ''}${yuan(Number(entry.deltaCents))} · ${dateText(entry.createdAt)}`).join('\n')
          : '\n\n暂无资金流水。'
      } else if (/^\/订单(?: \d+)?$/.test(content.trim()) || content.trim() === '/待结算') {
        const take = Math.min(20, Math.max(1, Number(content.split(' ')[1] || 5)))
        const pendingOnly = content.trim() === '/待结算'
        // 查看全部订单前先立即同步一次，确保刚下的单能查到（动态导入避免与 order-sync 循环依赖）
        if (!pendingOnly) {
          const { syncOrdersNow } = await import('./order-sync')
          await syncOrdersNow().catch((e) => console.warn(`[订单同步] 查询前同步失败：${e instanceof Error ? e.message : e}`))
        }
        const plugins = listPlatforms()
        // 按平台原始状态换算当前状态；已取消的订单不展示
        const rows = (
          await db.affiliateOrder.findMany({ where: { userId: id }, take: 100, orderBy: { placedAt: 'desc' }, include: { items: true } })
        )
          .map((o) => {
            const plugin = plugins.find((p) => p.id === o.platform)
            return { o, status: o.status === 'UNATTRIBUTED' && plugin ? plugin.orderStatus(o.rawStatus || '') : o.status }
          })
          .filter(({ status }) => status !== 'CANCELLED' && (!pendingOnly || status === 'PAID'))
          .slice(0, take)
        const label: Record<string, string> = { CREATED: '待付款', PAID: '已付款，待结算', COMPLETED: '已完成', UNATTRIBUTED: '待核实' }
        reply = rows.length
          ? rows
              .map(({ o, status }) =>
                [
                  o.items[0]?.title || o.externalOrderId,
                  `${o.platform === 'jd' ? '京东' : o.platform === 'taobao' ? '淘宝' : o.platform} · ${label[status] || '待核实'}`,
                  o.amountCents ? `金额：${yuan(Number(o.amountCents))}` : null,
                  o.rebateCents != null ? `返现：${yuan(Number(o.rebateCents))}` : null,
                  `下单：${dateText(o.placedAt)}`,
                  `订单号：${o.externalOrderId}`,
                ]
                  .filter(Boolean)
                  .join('\n'),
              )
              .join('\n\n')
          : pendingOnly ? '暂无待结算订单。' : '暂无订单。'
      } else if (content.trim() === '/提现记录') {
        const rows = await db.withdrawalRequest.findMany({
          where: { userId: id },
          take: 10,
          orderBy: { createdAt: 'desc' },
        })
        reply = rows.length
          ? rows.map((w) => `¥${(Number(w.amountCents) / 100).toFixed(2)} · ${w.status}`).join('\n')
          : '暂无提现记录。'
      } else if (content.trim().startsWith('/提现'))
        reply = '提现申请暂未开放：订单归属与收款信息尚未完成核验。系统不会自动打款，请联系管理员。'
      else if (content.includes('https://')) {
        try {
          const p = await convert(content, id, message.id, id)
          const known = !['商品信息暂不可用', '淘宝商品'].includes(p.product)
          // 购买链接：淘宝优先用淘口令里的 m.tb.cn 链接（手淘识别率高），否则用推广短链；卡片点击与第二条消息用同一个链接
          const taobao = p.category === '淘宝商品'
          const buyUrl = (taobao && p.password && /https:\/\/m\.tb\.cn\/[\w.]+/.exec(p.password)?.[0]) || p.promotionUrl
          // 淘口令里取到链接为止（去掉后面的商品标题等文案）；口令里没有链接时在口令后补上购买链接
          const tpwdHead = taobao && p.password ? /^[\s\S]*?https:\/\/m\.tb\.cn\/[\w.]+/.exec(p.password.trim())?.[0] : null
          const buyText = tpwdHead ? tpwdHead.replace(/\s+/g, ' ') : taobao && p.password ? `${p.password.trim()} ${buyUrl}` : buyUrl
          // 图文卡片：商品图 + 价格摘要，点击卡片直接打开购买链接
          reply = {
            title: known ? p.product : `${p.category || '商品'} · 转链成功`,
            description: [
              p.shop ? `店铺：${p.shop}（下单前请核对是否为你看到的店铺）` : null,
              `售价：${yuan(p.price)}`,
              `优惠券：${p.coupon ? yuan(p.coupon) : p.coupon === 0 ? '无' : '待确认'}`,
              p.finalPrice != null ? `预计到手：${yuan(p.finalPrice)}` : null,
              `预计返现：${p.rebate != null ? yuan(p.rebate) : '待确认'}`,
              !known && p.infoMessage ? `商品信息未获取：${p.infoMessage}` : null,
            ].filter(Boolean).join('\n'),
            url: buyUrl,
            picurl: p.imageUrl || undefined,
            // 第二条：淘宝为「淘口令 + 链接」（如 87￥ HU006 dMKpTuBpLuF￥ https://m.tb.cn/h.xxx），京东只发链接，方便长按复制
            followup: `${buyText}\n复制这条消息，打开手机${taobao ? '淘宝' : '京东'}即可领券购买`,
          }
        } catch (e) {
          reply = e instanceof Error ? e.message : '转链失败，请稍后重试。'
        }
      }
      console.log(`[企业微信] ${sender}：${content.trim().slice(0, 60)}`)
      const wecom = await readConfig('wecom')
      try {
        await send(wecom, sender, reply)
        if (typeof reply !== 'string' && reply.followup) await send(wecom, sender, reply.followup)
      } catch (e) {
        if (typeof reply === 'string') throw e
        // 图文发送失败时退回纯文本，保证用户能拿到链接
        console.warn(`[企业微信] 图文消息发送失败，改发文本：${e instanceof Error ? e.message : e}`)
        await send(
          wecom,
          sender,
          reply.description.includes(reply.url)
            ? `${reply.title}\n${reply.description}`
            : `${reply.title}\n${reply.description}\n推广链接：${reply.url}`,
        )
      }
      const summary = (typeof reply === 'string' ? reply : `[图文] ${reply.title}`).replace(/\s+/g, ' ').slice(0, 60)
      console.log(`[企业微信] 已回复 ${sender}：${summary}`)
      await db.incomingMessage.update({
        where: { id: message.id },
        data: { status: 'COMPLETED', lockedUntil: null, errorCode: null },
      })
    } catch (e) {
      console.warn(`[企业微信] 消息处理失败（第 ${message.attempts + 1} 次）：${e instanceof Error ? e.message : e}`)
      await db.incomingMessage.update({
        where: { id: message.id },
        data: {
          status: message.attempts >= 4 ? 'FAILED' : 'PENDING',
          lockedUntil: null,
          nextAttemptAt: new Date(Date.now() + 60000 * Math.pow(2, message.attempts)),
          errorCode: 'MESSAGE_PROCESS_FAILED',
        },
      })
    }
  } finally {
    running = false
  }
}
