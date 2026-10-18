import { createHash, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { db, dateText } from './database'
import { readConfig, wecomToken, wecomUrl, wecomError, type Config } from './integrations'
import { convert } from './business'
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
    body: JSON.stringify({ touser: user, agentid: Number(c.agentId), ...body, enable_duplicate_check: 1, duplicate_check_interval: 1800 }),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  })
  const data = (await r.json()) as any
  if (!r.ok || data.errcode !== 0 || data.invaliduser)
    throw new Error(data.invaliduser ? `接收人无效：${data.invaliduser}` : wecomError('消息发送失败', data))
}
const yuan = (cents: number | null | undefined) => (cents == null ? '待确认' : `¥${(cents / 100).toFixed(2)}`)
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
      let reply: string | News = '发送商品链接查询优惠和预计返现。\n/订单 查看自己的订单\n/待结算 查看待结算订单\n/余额 查看账户金额\n/提现记录 查看提现进度\n订单同步可能延迟，返现以联盟结算为准；取消或退款可能影响返现。'
      if (!identity.user.enabled) reply = '当前账户已禁用，请联系管理员。'
      else if (content.trim() === '/查返利') reply = '直接发送京东、淘宝 / 天猫商品链接或含链接的分享文案，即可查询优惠与预计返现。价格和优惠以实际下单为准。'
      else if (content.trim() === '/支持平台') reply = `当前已接入：${listPlatforms().map((p) => p.name).join('、')}。\n直接发送商品链接或分享文案即可查询优惠与返现。各平台可用性取决于实际接口权限。`
      else if (content.trim() === '/订单找回') reply = '订单找回暂未开放。请联系管理员核查订单号，核验前不会自动绑定或发放返现。'
      else if (content.trim() === '/余额') {
        const w = await db.walletAccount.findUnique({ where: { userId: id } })
        const amount = (n?: bigint) => `${(Number(n || 0n) / 100).toFixed(2)}`
        reply = `我的返现账户\n可提现：¥${amount(w?.availableCents)}\n待结算：¥${amount(w?.pendingCents)}\n冻结：¥${amount(w?.frozenCents)}\n累计提现：¥${amount(w?.withdrawnCents)}`
        const entries = w ? await db.walletTransaction.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'desc' }, take: 5 }) : []
        reply += entries.length ? '\n\n最近流水\n' + entries.map((entry) => `${entry.reason} ${entry.deltaCents > 0n ? '+' : ''}¥${amount(entry.deltaCents)} · ${dateText(entry.createdAt)}`).join('\n') : '\n\n暂无资金流水。'
      } else if (/^\/订单(?: \d+)?$/.test(content.trim()) || content.trim() === '/待结算') {
        const take = Math.min(20, Math.max(1, Number(content.split(' ')[1] || 5)))
        const rows = await db.affiliateOrder.findMany({
          where: { userId: id, ...(content.trim() === '/待结算' ? { status: 'PAID' as const } : {}) },
          take,
          orderBy: { placedAt: 'desc' },
          include: { items: true },
        })
        reply = rows.length
          ? rows
              .map((o) => {
                const status: Record<string, string> = { CANCELLED: '已取消', CREATED: '待付款', PAID: '已付款，待结算', COMPLETED: '已完成', UNATTRIBUTED: '待核实' }
                const money = (v: bigint | null) => v === null ? '待确认' : `¥${(Number(v) / 100).toFixed(2)}`
                return `${o.items[0]?.title || o.externalOrderId}\n${o.platform === 'jd' ? '京东' : o.platform} · ${status[o.status] || '待核实'}\n金额：${money(o.amountCents)}\n预计返现：${money(o.rebateCents)}\n下单：${dateText(o.placedAt)}\n订单号：${o.externalOrderId}`
              })
              .join('\n\n')
          : content.trim() === '/待结算' ? '暂无待结算订单。' : '暂无已确认归属的订单。'
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
          // 图文卡片：商品图 + 价格摘要，点击卡片直接打开推广链接
          reply = {
            title: known ? p.product : `${p.category || '商品'} · 转链成功`,
            description: [
              `售价：${yuan(p.price)}`,
              `优惠券：${p.coupon ? yuan(p.coupon) : p.coupon === 0 ? '无' : '待确认'}`,
              p.finalPrice != null ? `预计到手：${yuan(p.finalPrice)}` : null,
              `预计返现：${p.rebate != null ? yuan(p.rebate) : '待确认'}（以联盟结算为准）`,
              !known && p.infoMessage ? `商品信息未获取：${p.infoMessage}` : null,
              p.password ? `淘口令：${p.password}` : null,
              p.password ? '👉 点击卡片购买，或复制下一条消息打开手机淘宝' : '👉 点击卡片前往购买',
            ].filter(Boolean).join('\n'),
            url: p.promotionUrl,
            picurl: p.imageUrl || undefined,
            // 淘口令单独发一条文本，方便长按复制后打开手机淘宝
            followup: p.password ? `${p.password} 复制这条消息，打开手机淘宝即可领券购买` : undefined,
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
        await send(wecom, sender, `${reply.title}\n${reply.description.replace('👉 点击卡片前往购买', '')}推广链接：${reply.url}`)
      }
      console.log(`[企业微信] 已回复 ${sender}`)
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
