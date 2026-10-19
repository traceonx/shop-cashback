import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import type { PlatformConfig, PlatformPlugin } from '../types'
import { decimalCents, jdOrderImage, resolveJdSku } from './index'

/**
 * 京东第三方接入：喵有券（ecapi.cn）商品查券与转链。
 * 独立于京东联盟官方接入，后台单独配置并通过开关启用；启用后京东链接改由此处转链。
 * 调用的是用户授权给喵有券的京东联盟账号，推广订单仍归属该联盟账号，订单同步继续走官方接口。
 * 文档：https://www.ecapi.cn/index/index/openapi/id/51.shtml（商品查询）、id/56（转链）
 */
export const ECAPI_KIND = 'jd-ecapi'
export const ecapiFields = [
  ['enabled', '启用', false],
  ['apiKey', '喵有券 apkey', true],
  ['keyId', '喵有券 key_id（京东授权调用 Key）', true],
  ['positionId', '推广位 ID（可选）', false],
] as const
export const ecapiConfigured = (c: PlatformConfig) => !!(c.apiKey?.trim() && c.keyId?.trim())
export const ecapiEnabled = (c: PlatformConfig) => c.enabled === 'true' && ecapiConfigured(c)

const hints: Record<string, string> = {
  '401': '服务器公网出口 IP 未加入喵有券白名单，请在喵有券后台添加后重试',
  '429': '喵有券接口访问次数超限，请稍后重试',
  '403': '喵有券接口关键参数缺失',
  '405': '喵有券接口请求方式错误',
  '1038': 'key_id 授权无效，请在喵有券「京东授权列表」重新授权并复制调用 Key',
}
const clean = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
// 保留第三方返回的大整数（商品 / 订单 ID）
const parse = (text: string): any =>
  JSON.parse(text, (_key, value, context?: { source: string }) =>
    typeof value === 'number' && !Number.isSafeInteger(value) && context?.source ? context.source : value,
  )
function list(value: any, element: string): any[] | null {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Object.hasOwn(value, element)) {
    const rows = value[element]
    return Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? [rows] : null
  }
  return null
}

/** 喵有券通用 GET 调用（京东 / 淘宝共用）：path 如 jingdong/getJdUnionItems、taoke/doCommonPromotionUrlParse */
export async function ecapiCall(path: string, params: Record<string, string | undefined>) {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') query.set(k, v)
  let response: Response
  try {
    response = await fetch(`https://api.web.ecapi.cn/${path}?${query}`, { signal: AbortSignal.timeout(12000), redirect: 'error' })
  } catch {
    throw new ServiceUnavailableException('喵有券接口网络连接失败或超时')
  }
  let raw: any
  try {
    raw = parse(await response.text())
  } catch {
    throw new ServiceUnavailableException(`喵有券接口响应格式异常（HTTP ${response.status}）`)
  }
  const code = String(raw?.code ?? response.status).replace(/[^\w.-]/g, '').slice(0, 20)
  if (code !== '200')
    throw new BadRequestException(`喵有券接口未成功（错误码 ${code}）：${hints[code] || clean(raw?.msg) || '请核查配置'}`)
  return raw.data
}

export async function ecapiRequest(c: PlatformConfig, method: string, params: Record<string, string | undefined>) {
  if (!ecapiConfigured(c)) throw new ServiceUnavailableException('请先在「京东联盟 · 喵有券」配置中保存 apkey 和 key_id')
  return ecapiCall(`jingdong/${method}`, { apkey: c.apiKey.trim(), key_id: c.keyId.trim(), ...params })
}

const PROMOTION_HOSTS = ['u.jd.com', '3.cn', 'union-click.jd.com']
function promotionLink(value: unknown) {
  try {
    const u = new URL(String(value))
    if (
      typeof value === 'string' &&
      u.protocol === 'https:' &&
      PROMOTION_HOSTS.includes(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.port
    )
      return value
  } catch {}
  throw new BadRequestException('喵有券未返回有效的京东推广链接')
}

type Goods = {
  sku: string | null
  product: string
  price: number | null
  imageUrl: string | null
  commission: number | null
  coupon: number | null
  payablePrice: number | null
  couponUrl?: string
  notice?: string
}
/** 解析商品并选出单件可直接使用的优惠券（规则与官方插件一致，另外把“门槛都达不到”视为无券） */
export function ecapiGoods(item: any): Goods {
  const g: Goods = {
    sku: item?.skuId ? String(item.skuId) : null,
    product: String(item?.skuName || '商品信息暂不可用'),
    price: decimalCents(item?.priceInfo?.price),
    imageUrl: jdOrderImage({ goodsInfo: { imageUrl: list(item?.imageInfo?.imageList, 'urlInfo')?.[0]?.url } }),
    commission: null,
    coupon: null,
    payablePrice: null,
  }
  const info = item?.couponInfo
  const empty = !!item && Object.hasOwn(item, 'couponInfo') && (info == null || (typeof info === 'object' && Object.keys(info).length === 0))
  const coupons = empty ? [] : list(info?.couponList, 'coupon')
  const salePrice = decimalCents(item?.priceInfo?.lowestPrice ?? item?.priceInfo?.price)
  if (Array.isArray(coupons) && coupons.length === 0) {
    g.coupon = 0
    g.payablePrice = decimalCents(item.priceInfo?.lowestCouponPrice) ?? salePrice
    g.commission = decimalCents(item.commissionInfo?.couponCommission ?? item.commissionInfo?.commission)
    return g
  }
  const now = Date.now()
  const best = coupons?.find(
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
  if (best && typeof best.link === 'string' && decimalCents(best.discount) !== null) {
    const u = new URL(best.link)
    if (
      ['https:', 'http:'].includes(u.protocol) &&
      ['coupon.jd.com', 'coupon.m.jd.com'].includes(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.port
    ) {
      g.couponUrl = best.link
      g.coupon = decimalCents(best.discount)
      g.payablePrice = decimalCents(item.priceInfo?.lowestCouponPrice)
      g.commission = decimalCents(item.commissionInfo?.couponCommission)
      return g
    }
  }
  // 所有券门槛都高于单件售价（如满 200 减 25 的 18.6 元商品）：单件购买用不上券，按无券计算
  if (coupons && salePrice !== null && coupons.every((v: any) => decimalCents(v.quota) !== null && decimalCents(v.quota)! > salePrice)) {
    g.coupon = 0
    g.payablePrice = salePrice
    g.commission = decimalCents(item.commissionInfo?.commission)
    g.notice = '优惠券未达使用门槛，按无券计算'
    return g
  }
  g.notice = '优惠券需核对领取条件，暂不计算券后到手价'
  return g
}

/** 先查商品与优惠券，再生成推广链接（有可用券时生成含券链接） */
export async function ecapiConvert(
  c: PlatformConfig,
  url: string,
  trackingCode?: string,
): ReturnType<PlatformPlugin['convert']> {
  const notices: string[] = []
  let g: Goods | null = null
  try {
    const data = await ecapiRequest(c, 'getJdUnionItems', { keyword: url, sceneId: '2', pageIndex: '1', pageSize: '1' })
    const rows = Array.isArray(data?.list) ? data.list : []
    if (rows.length !== 1) throw new Error('喵有券未匹配到该商品')
    g = ecapiGoods(rows[0])
    if (g.notice) notices.push(g.notice)
  } catch (e) {
    notices.push((e as Error).message)
  }
  const base = {
    sceneId: '2',
    chainType: '3',
    positionId: c.positionId?.trim() || undefined,
    // 未在喵有券开通子联盟权限时会被忽略，订单按 SKU 兜底匹配用户
    subUnionId: trackingCode,
  }
  const plain = () => ecapiRequest(c, 'doItemCpsUrl', { ...base, materialId: url, autoSearch: '1' })
  let data: any
  if (g?.couponUrl && g.sku) {
    try {
      // 券与商品二合一时 materialId 须为商品详情页链接
      data = await ecapiRequest(c, 'doItemCpsUrl', { ...base, materialId: `https://item.jd.com/${g.sku}.html`, couponUrl: g.couponUrl })
    } catch {
      data = await plain()
      notices.push('含券链接生成失败，已生成普通推广链接，请以下单页优惠为准')
      g = { ...g, coupon: null, payablePrice: null }
    }
  } else data = await plain()
  const link = promotionLink(data?.shortURL || data?.clickURL)
  const sku = g?.sku || (await resolveJdSku(url).catch(() => undefined)) || null
  return {
    link,
    snapshot: {
      product: g?.product || '商品信息暂不可用',
      sku: sku || undefined,
      price: g?.price ?? null,
      imageUrl: g?.imageUrl ?? null,
      commission: g?.commission ?? null,
      coupon: g?.coupon ?? null,
      payablePrice: g?.payablePrice ?? null,
      infoMessage: notices.join('；'),
      rebate: null,
      finalPrice: null,
      category: '京东商品',
      trackingVerified: false as const,
    },
  }
}

export async function ecapiTest(c: PlatformConfig) {
  await ecapiRequest(c, 'getJdUnionItems', { keyword: '手机', sceneId: '1', pageIndex: '1', pageSize: '1' })
  return c.enabled === 'true'
    ? '喵有券接口可用，京东链接将通过喵有券转链和查券。'
    : '喵有券接口可用；当前未启用，京东链接仍走官方接入。'
}
