import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { dateText } from '../../database'
import { extractJdUrl } from '../../domain'
import type { PlatformConfig, PlatformPlugin, PlatformOrder, PlatformOrderStatus } from '../types'
export function jdSign(params: Record<string, string>, secret: string) {
  return createHash('md5')
    .update(
      secret +
        Object.keys(params)
          .sort()
          .map((k) => k + params[k])
          .join('') +
        secret,
    )
    .digest('hex')
    .toUpperCase()
}
export function decimalCents(value: unknown): number | null {
  const s = String(value ?? '')
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null
  const [whole, fraction = ''] = s.split('.')
  const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null
}
// JD's documented examples wrap lists in their singular element name.
function jdList(value: any, element: string): any[] | null {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Object.hasOwn(value, element)) {
    const rows = value[element]
    return Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? [rows] : null
  }
  return null
}
// Preserve upstream integers larger than 2^53 (order IDs / SKU IDs).
export function parseJdJson(text: string): any {
  return JSON.parse(text, (_key, value, context?: { source: string }) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      if (context?.source) return context.source
      if (Number.isInteger(value)) throw new Error('当前运行环境无法精确解析大整数')
    }
    return value
  })
}
export function jdDate(value: unknown): Date | null {
  if (value == null || value === '' || value === 0 || value === '0') return null
  const raw = String(value)
  const date = /^\d{13}$/.test(raw)
    ? new Date(Number(raw))
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
      ? new Date(raw.replace(' ', 'T') + '+08:00')
      : new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}
export function orderRows(result: { data?: unknown; hasMore?: boolean }) {
  if (result.data == null && result.hasMore !== true) return []
  if (!Array.isArray(result.data)) throw new ServiceUnavailableException('京东订单响应格式异常')
  return result.data
}
export async function jdRequest(c: PlatformConfig, method: string, body: unknown, full = false) {
  if (!c.appKey || !c.appSecret) throw new ServiceUnavailableException('请先在联盟配置中保存 AppKey 和 AppSecret')
  const timestamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
  const p: Record<string, string> = {
    method,
    app_key: c.appKey,
    timestamp,
    format: 'json',
    v: '1.0',
    sign_method: 'md5',
    '360buy_param_json': JSON.stringify(body),
  }
  p.sign = jdSign(p, c.appSecret)
  let response: Response
  try {
    response = await fetch('https://api.jd.com/routerjson', {
      method: 'POST',
      body: new URLSearchParams(p),
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    })
  } catch (error) {
    const failure = error as { name?: string; cause?: { code?: string } }
    if (['EACCES', 'EPERM'].includes(failure.cause?.code || ''))
      throw new ServiceUnavailableException(
        '后端网络访问被运行环境拒绝，请检查服务进程的网络权限；无需重新填写联盟密钥',
      )
    throw new ServiceUnavailableException('京东接口网络连接失败或超时')
  }
  if (!response.ok) throw new ServiceUnavailableException(`京东接口 HTTP ${response.status}`)
  const raw = parseJdJson(await response.text()) as Record<string, any>
  if (raw.error_response)
    throw new BadRequestException(
      `京东接口拒绝请求，错误码 ${String(raw.error_response.code || 'UNKNOWN')
        .replace(/[^\w.-]/g, '')
        .slice(0, 30)}`,
    )
  const envelope = raw[`${method.replaceAll('.', '_')}_response`] || raw[`${method.replaceAll('.', '_')}_responce`]
  const encoded = envelope?.result || envelope?.queryResult || envelope?.getResult
  let result: any
  try {
    result = typeof encoded === 'string' ? parseJdJson(encoded) : encoded
  } catch {
    throw new ServiceUnavailableException('京东接口响应格式异常')
  }
  if (!result || Number(result.code) !== 200)
    throw new BadRequestException(
      `京东业务接口未成功，错误码 ${String(result?.code || envelope?.code || 'UNKNOWN')
        .replace(/[^\w.-]/g, '')
        .slice(0, 30)}；请核查账号权限及参数`,
    )
  return full ? result : result.data
}

export function jdOrderImage(value: unknown): string | null {
  const raw = value as { goodsInfo?: { imageUrl?: unknown } } | null
  const image = raw?.goodsInfo?.imageUrl
  if (typeof image !== 'string') return null
  try {
    const url = new URL(image)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname.endsWith('.360buyimg.com') ||
      url.username ||
      url.password ||
      url.port
    )
      return null
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}
export function jdOrderAmounts(value: unknown) {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const price = decimalCents(raw.price),
    quantity = Number(raw.skuNum)
  const total =
    price !== null && Number.isSafeInteger(quantity) && quantity > 0 ? BigInt(price) * BigInt(quantity) : null
  const completed = String(raw.validCode) === '17'
  const cancelled = String(raw.validCode) === '3'
  return {
    amount: total !== null && total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null,
    commission: cancelled ? 0 : decimalCents(completed ? (raw.actualFee ?? raw.estimateFee) : raw.estimateFee),
    commissionBase: decimalCents(completed ? (raw.actualCosPrice ?? raw.estimateCosPrice) : raw.estimateCosPrice),
  }
}
export function jdOrderStatus(code: string): PlatformOrderStatus {
  return (
    ({ '3': 'CANCELLED', '15': 'CREATED', '16': 'PAID', '17': 'COMPLETED' } as Record<string, PlatformOrderStatus>)[
      code
    ] || 'UNATTRIBUTED'
  )
}
export function normalizeOrder(raw: any): PlatformOrder {
  if (
    !raw ||
    !raw.id ||
    !raw.orderId ||
    [raw.id, raw.orderId].some((v) => typeof v === 'number' && !Number.isSafeInteger(v))
  )
    throw new BadRequestException('订单唯一标识不可靠，已停止导入')
  const amount = decimalCents(raw.actualCosPrice ?? raw.estimateCosPrice),
    placedAt = jdDate(raw.orderTime)
  if (amount === null || !placedAt) throw new BadRequestException('订单金额或时间格式无法确认，已停止导入')
  return {
    trackingCode: typeof raw.subUnionId === 'string' && /^[a-f0-9]{32}$/.test(raw.subUnionId) ? raw.subUnionId : null,
    status: jdOrderStatus(String(raw.validCode)),
    orderId: String(raw.orderId),
    lineId: String(raw.id),
    rawStatus: String(raw.validCode ?? 'UNKNOWN'),
    raw,
    placedAt,
    completedAt: jdDate(raw.finishTime),
    commissionCents: jdOrderAmounts(raw).commission,
    commissionBaseCents: amount,
    sku: String(raw.skuId || ''),
    title: String(raw.skuName || '商品信息待确认'),
    quantity: Number.isSafeInteger(raw.skuNum) ? raw.skuNum : 1,
  }
}
export async function resolveJdSku(input: string): Promise<string | undefined> {
  let url = new URL(input)
  for (let hop = 0; hop < 5; hop++) {
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['3.cn', 'u.jd.com', 'union-click.jd.com', 'item.jd.com', 'item.m.jd.com'].includes(url.hostname)
    )
      return undefined
    if (['item.jd.com', 'item.m.jd.com'].includes(url.hostname))
      return url.pathname.match(/\/(?:product\/)?(\d+)\.html$/)?.[1]
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) })
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return undefined
    url = new URL(location, url)
  }
  return undefined
}
export const jdPlugin: PlatformPlugin = {
  orderStatus: jdOrderStatus,
  orderAmounts: jdOrderAmounts,
  orderImage: jdOrderImage,
  id: 'jd',
  name: '京东',
  accountId: 'jd-primary',
  documentationUrl: 'https://union.jd.com/openplatform/api/12707',
  authentication: {
    mode: 'app-credentials',
    description: '使用京东联盟应用 AppKey / AppSecret 查询推广订单。网页登录不会自动授权本系统。',
  },
  fields: [
    ['appKey', 'AppKey', false],
    ['appSecret', 'AppSecret', true],
    ['unionId', '联盟 ID', false],
    ['siteId', '网站 / APP / 流量媒体 ID（siteId，仅转链需要）', false],
    ['positionId', '推广位 ID（可选）', false],
  ],
  maxHistoryDays: 90,
  maxWindowMs: 3600000,
  configured: (c) => !!(c.appKey && c.appSecret),
  normalizeUrl: extractJdUrl,
  async convert(c, url, trackingCode) {
    const missing = [
      ['appKey', 'AppKey'],
      ['appSecret', 'AppSecret'],
      ['siteId', '网站 / APP / 流量媒体 ID（siteId）'],
    ]
      .filter(([key]) => !c[key]?.trim())
      .map(([, label]) => label)
    if (missing.length)
      throw new BadRequestException(`尚未保存：${missing.join('、')}。请到联盟配置填写并点击保存配置后重试。`)
    const req: Record<string, unknown> = { materialId: url, siteId: c.siteId }
    if (c.positionId) req.positionId = c.positionId
    if (trackingCode) req.subUnionId = trackingCode
    const response = await jdRequest(c, 'jd.union.open.promotion.common.get', { promotionCodeReq: req })
    // 优先短链（u.jd.com），便于在消息与后台展示
    let link = response?.shortURL || response?.clickURL
    if (typeof link !== 'string' || link === url) throw new BadRequestException('京东未返回有效推广链接')
    const parsed = new URL(link)
    if (
      parsed.protocol !== 'https:' ||
      !['u.jd.com', '3.cn', 'union-click.jd.com'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.port
    )
      throw new BadRequestException('京东推广链接格式无法确认')
    let product = '商品信息暂不可用',
      price: number | null = null,
      imageUrl: string | null = null,
      commission: number | null = null,
      coupon: number | null = null,
      payablePrice: number | null = null
    const notices: string[] = []
    let complete = false
    try {
      const data = await jdRequest(c, 'jd.union.open.goods.query', {
        goodsReqDTO: { keyword: link, sceneId: 1, pageIndex: 1, pageSize: 10 },
      })
      const goods = jdList(data, 'goodsResp')
      if (!goods || goods.length !== 1) throw new Error('未能唯一匹配商品信息')
      const item = goods[0]
      product = String(item.skuName || product)
      price = decimalCents(item.priceInfo?.price)
      imageUrl = jdOrderImage({ goodsInfo: { imageUrl: jdList(item.imageInfo?.imageList, 'urlInfo')?.[0]?.url } })
      const couponInfo = item.couponInfo
      const emptyCouponInfo = Object.hasOwn(item, 'couponInfo') &&
        (couponInfo == null || (typeof couponInfo === 'object' && Object.keys(couponInfo).length === 0))
      const coupons = emptyCouponInfo ? [] : jdList(couponInfo?.couponList, 'coupon')
      // Only a confirmed no-coupon response permits a no-coupon net-price estimate.
      if (Array.isArray(coupons) && coupons.length === 0) {
        coupon = 0
        payablePrice = decimalCents(item.priceInfo?.lowestCouponPrice)
        commission = decimalCents(item.commissionInfo?.couponCommission ?? item.commissionInfo?.commission)
      } else {
        const now = Date.now(),
          salePrice = decimalCents(item.priceInfo?.lowestPrice ?? item.priceInfo?.price)
        const best = Array.isArray(coupons)
          ? coupons.find(
              (v: any) =>
                Number(v.isBest) === 1 &&
                Number(v.couponStyle ?? 0) === 0 &&
                Number(v.couponStatus ?? 0) !== -1 &&
                Number(v.getStartTime) <= now &&
                Number(v.getEndTime) >= now &&
                Number(v.useStartTime) <= now &&
                Number(v.useEndTime) >= now &&
                salePrice !== null &&
                decimalCents(v.quota) !== null &&
                salePrice >= decimalCents(v.quota)!,
            )
          : null
        if (best && typeof best.link === 'string' && decimalCents(best.discount) !== null) {
          const couponUrl = new URL(best.link)
          if (
            !['https:', 'http:'].includes(couponUrl.protocol) ||
            !['coupon.jd.com', 'coupon.m.jd.com'].includes(couponUrl.hostname) ||
            couponUrl.username ||
            couponUrl.password ||
            couponUrl.port
          )
            throw new Error('优惠券链接格式无法确认')
          const couponResponse = await jdRequest(c, 'jd.union.open.promotion.common.get', {
            promotionCodeReq: { ...req, couponUrl: best.link },
          })
          const couponLink = couponResponse?.shortURL || couponResponse?.clickURL
          const target = new URL(couponLink)
          if (
            target.protocol !== 'https:' ||
            !['u.jd.com', '3.cn', 'union-click.jd.com'].includes(target.hostname) ||
            target.username ||
            target.password ||
            target.port
          )
            throw new Error('含券推广链接格式无法确认')
          link = couponLink
          coupon = decimalCents(best.discount)
          payablePrice = decimalCents(item.priceInfo?.lowestCouponPrice)
          commission = decimalCents(item.commissionInfo?.couponCommission)
        } else {
          notices.push('优惠券需核对领取条件，暂不计算券后到手价')
          commission = null
        }
      }
      complete = true
    } catch (e) {
      notices.push(
        (e as Error).message.includes('403')
          ? '商品与优惠查询未授权（京东返回 403：无访问权限）'
          : (e as Error).message,
      )
    }
    if (!complete) {
      try {
        const sku = await resolveJdSku(url)
        if (!sku) throw new Error('无法从短链接识别商品，请使用商品详情链接重试')
        const info = await jdRequest(c, 'jd.union.open.goods.promotiongoodsinfo.query', { skuIds: sku })
        const item = Array.isArray(info) ? info.find((v: any) => String(v.skuId) === sku) : null
        if (!item) throw new Error('商品接口未返回该商品')
        product = String(item.goodsName || product)
        price = decimalCents(item.unitPrice)
        commission = decimalCents(item.commision)
        imageUrl = jdOrderImage({ goodsInfo: { imageUrl: item.imgUrl } })
      } catch (e) {
        notices.push(
          (e as Error).message.includes('403')
            ? '基础商品信息未授权（京东返回 403：无访问权限）'
            : (e as Error).message,
        )
      }
    }
    const snapshot = {
      product,
      price,
      imageUrl,
      commission,
      coupon,
      payablePrice,
      infoMessage: notices.join('；'),
      rebate: null,
      finalPrice: null,
      category: '京东商品',
      trackingVerified: false as const,
    }

    return { link, snapshot }
  },
  async test(c) {
    const until = new Date(),
      from = new Date(until.getTime() - 3600000)
    const page = await this.queryOrders(c, { from, until, page: 1, type: 3 })
    return page.rows.length
      ? '订单接口可用，最近一小时有订单更新，请到订单管理同步。'
      : '订单接口可用，最近一小时没有订单更新。可到订单管理选择历史范围同步。'
  },
  async queryOrders(c, request) {
    const result = await jdRequest(
      c,
      'jd.union.open.order.row.query',
      {
        orderReq: {
          type: request.type,
          startTime: dateText(request.from),
          endTime: dateText(request.until),
          pageIndex: request.page,
          pageSize: 100,
          fields: 'goodsInfo',
        },
      },
      true,
    )
    const rows = orderRows(result)
    return {
      rows: rows.map(normalizeOrder),
      hasMore: typeof result.hasMore === 'boolean' ? result.hasMore : rows.length === 100,
    }
  },
}
