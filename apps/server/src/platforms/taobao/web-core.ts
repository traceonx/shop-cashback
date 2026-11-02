import { BadRequestException } from '@nestjs/common'
import { decimalCents, parseJdJson } from '../jd'
import type { PlatformPlugin } from '../types'
import { normalizeTaobaoOrder } from './orders'

export type WebState = 'NONE' | 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'VERIFY' | 'LIMITED' | 'NETWORK'
export type WebIncident = { state: WebState; lastValid?: number; expiredAt?: number; incident?: string; attempts?: number; notified?: boolean; retryAt?: number; nextAt?: number }
export function applyWebResult(s: WebIncident, kind: WebState | 'FORMAT' | 'BUSINESS' | undefined, now: number, incident: string) {
  if (!kind) {
    s.state = 'ACTIVE'; s.lastValid = now; s.expiredAt = undefined
    s.incident = undefined; s.attempts = 0; s.notified = false
  } else if (kind === 'EXPIRED') {
    if (s.lastValid && !s.incident) {
      s.incident = incident; s.expiredAt = now; s.attempts = 0; s.notified = false; s.retryAt = 0
    }
    s.state = 'EXPIRED'
  } else if (['VERIFY', 'LIMITED', 'NETWORK'].includes(kind)) {
    s.state = kind as WebState; s.nextAt = now + (kind === 'LIMITED' ? 60000 : 15000)
  }
}
export class WebError extends BadRequestException {
  constructor(public kind: WebState | 'FORMAT' | 'BUSINESS', message: string) { super(message) }
}
export function webResponse(status: number, text: string, location = ''): any {
  if (status === 429) throw new WebError('LIMITED', '淘宝网页请求限流，稍后重试')
  if (status === 401 || /^https:\/\/login\.(?:taobao|tmall|alimama)\.com(?:\/|$)/.test(location))
    throw new WebError('EXPIRED', '淘宝联盟网页登录已失效')
  if (status === 403) throw new WebError('VERIFY', '淘宝联盟需要人工验证，请点击重新登录')
  if (status >= 500) throw new WebError('NETWORK', '淘宝联盟网页服务暂不可用')
  let r: any
  try { r = parseJdJson(text) } catch {
    if (/captcha|punish|验证码|滑块|风控|访问受限|访问被拒绝/i.test(text)) throw new WebError('VERIFY', '淘宝联盟需要人工验证')
    throw new WebError('FORMAT', '淘宝网页返回格式异常，请人工检查登录状态')
  }
  const code = [r?.bizErrorCode, r?.resultCode, r?.code, r?.message, r?.msg, r?.errorMsg, r?.bizErrorDesc]
    .filter(v => typeof v === 'string' || typeof v === 'number').join(' ')
  if (/NOT_LOGIN|SESSION_EXPIRED|SESSION_TIMEOUT|LOGIN_REQUIRED|未登录|请.{0,4}登录|登录.{0,5}(失效|过期)/i.test(code))
    throw new WebError('EXPIRED', '淘宝联盟网页登录已失效')
  if (/RGV|CAPTCHA|VERIFY|USER_VALIDATE|验证码|滑块|风控|访问受限|访问被拒绝/i.test(code)) throw new WebError('VERIFY', '淘宝联盟需要人工验证')
  if (/LIMIT|FREQUENCY|频繁|限流|限频/i.test(code)) throw new WebError('LIMITED', '淘宝联盟网页请求限流')
  if (status < 200 || status >= 300 || r?.success !== true || !r.data)
    throw new WebError('BUSINESS', '淘宝网页未返回成功结果（可能无推广资格或页面接口已变化）')
  return r.data
}
export function webHasNext(d: any, page: number) {
  if ([true, 'true', 1, '1'].includes(d.hasNext)) return true
  if ([false, 'false', 0, '0'].includes(d.hasNext)) return false
  if (Number.isInteger(Number(d.totalPages)) && Number(d.totalPages) >= 0) return page < Number(d.totalPages)
  throw new WebError('FORMAT', '网页订单缺少分页状态，已停止以免遗漏订单')
}
export function fallbackAllowed(e: unknown) {
  const kind = (e as { kind?: string })?.kind
  if (kind) return ['PERMISSION', 'RATE_LIMIT', 'TIMEOUT', 'UPSTREAM'].includes(kind)
  return /fetch failed|ECONN|timeout|超时|限流|接口权限|权限.*未开通|两者都未开通|网络失败|服务暂不可用/i.test(e instanceof Error ? e.message : '')
}
const https = (v: unknown) => {
  if (typeof v !== 'string' || !v) return null
  try {
    const u = new URL(v.startsWith('//') ? `https:${v}` : v)
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null
  } catch { return null }
}
export function webConversion(d: any, now = Date.now()): Awaited<ReturnType<PlatformPlugin['convert']>> {
  const coupon = decimalCents(d.couponAmount)
  const end = Number(d.couponEffectiveEndTime), start = Number(d.couponEffectiveStartTime)
  const validCoupon = coupon != null && coupon > 0 && Number.isFinite(start) && Number.isFinite(end) &&
    start <= now && now <= end && Number(d.couponRemainCount) > 0
  const couponLink = validCoupon ? https(d.couponShortLinkUrl || d.couponShareUrl) : null
  const link = couponLink || https(d.shortLinkurl || d.url)
  if (!link || !/(^|\.)(taobao\.com|tb\.cn|tmall\.com)$/.test(new URL(link).hostname))
    throw new WebError('FORMAT', '淘宝网页未返回有效推广链接')
  const rate = d.calTkRate == null || d.calTkRate === '' ? NaN : Number(d.calTkRate)
  const commissionRate = Number.isFinite(rate) && rate >= 0 && rate <= 10000 ? rate / 100 : null
  const price = decimalCents(d.promotionPrice)
  // 按展示售价减去本次有效券预估，实际返现由订单结算校正。
  const noCoupon = d.couponAmount == null || coupon === 0
  const usableCoupon = validCoupon && couponLink ? coupon : noCoupon ? 0 : null
  const payablePrice = price !== null && usableCoupon !== null && usableCoupon <= price ? price - usableCoupon : null
  const commission = payablePrice !== null && commissionRate !== null
    ? Number(BigInt(payablePrice) * BigInt(Math.round(rate * 1000000)) / 10000000000n) : null
  return { link, snapshot: {
    product: String(d.itemName || '淘宝商品'), sku: d.itemId == null ? undefined : String(d.itemId),
    price, imageUrl: https(d.pic), coupon: usableCoupon,
    commission, commissionRate, payablePrice, rebate: null, finalPrice: null,
    password: couponLink ? d.couponLinkTaoToken || undefined : d.taoToken || undefined,
    shop: d.shopTitle || undefined, category: '淘宝商品', trackingVerified: false,
    infoMessage: commission !== null ? '按当前售价、有效优惠券和佣金率预估，实际返现以订单结算为准' : '商品金额或佣金信息不完整，预计返现待确认',
  } }
}
export function webOrder(raw: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) normalized[k.replace(/[A-Z]/g, c => '_' + c.toLowerCase())] = v
  return normalizeTaobaoOrder({ ...normalized, _source: 'taobao-web', _web: raw })
}
export function mergeTaobaoRaw(previous: unknown, incoming: unknown) {
  const result = { ...(previous as Record<string, unknown>) }
  for (const [k, v] of Object.entries((incoming || {}) as Record<string, unknown>)) {
    if (v != null && v !== '') result[k] = v
  }
  return result
}
export function validateCookies(value: unknown): string {
  if (!Array.isArray(value) || value.length > 150) throw new BadRequestException('登录会话格式无效')
  const cookies = value.filter(c => c && typeof c.name === 'string' && typeof c.value === 'string' &&
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(c.name) && !/[\r\n;]/.test(c.value) &&
    ['pub.alimama.com', '.alimama.com', 'alimama.com'].includes(c.domain) &&
    typeof c.path === 'string' && '/openapi/param2/1/gateway.unionpub/'.startsWith(c.path))
    .sort((a, b) => b.path.length - a.path.length)
  const seen = new Set<string>()
  const header = cookies.filter(c => !seen.has(c.name) && !!seen.add(c.name)).map(c => `${c.name}=${c.value}`).join('; ')
  if (!header || header.length > 24000 || !cookies.some(c => c.name === '_tb_token_')) throw new BadRequestException('缺少淘宝联盟登录会话')
  return header
}
