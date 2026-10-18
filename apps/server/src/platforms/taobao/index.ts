// 淘宝联盟（推广者）插件：TOP 网关 MD5 签名；商品详情、万能转链（按商品 ID）、淘口令生成。
// 文档：taobao.tbk.item.info.upgrade.get / taobao.tbk.dg.general.link.convert / taobao.tbk.tpwd.create
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { decimalCents } from '../jd'
import type { PlatformConfig, PlatformPlugin, PlatformOrderStatus } from '../types'
import { taobaoFields } from './config'

const GATEWAY = 'https://eco.taobao.com/router/rest'
const HOSTS = ['taobao.com', 'tmall.com', 'tmall.hk', 'tb.cn', 'yao.95095.com', 'liangxinyao.com']

export function topSign(params: Record<string, string>, secret: string) {
  const text = Object.keys(params).sort().map((k) => k + params[k]).join('')
  return createHash('md5').update(secret + text + secret, 'utf8').digest('hex').toUpperCase()
}
const beijingTime = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date())

export class TopError extends Error {
  constructor(public code: string, public subCode: string, message: string) { super(message) }
}
const topHints: Record<string, string> = {
  '25': 'AppSecret 不正确（签名无效）',
  '29': 'AppKey 不正确',
  '11': '应用缺少该接口的权限包，请在淘宝联盟开放平台申请',
  '7': '调用频率超限，请稍后重试',
  '27': '时间戳无效，请检查服务器时间',
}
export async function topRequest(c: PlatformConfig, method: string, biz: Record<string, unknown> = {}) {
  if (!c.appKey || !c.appSecret) throw new ServiceUnavailableException('请先在渠道配置中保存淘宝联盟 AppKey 和 AppSecret')
  const params: Record<string, string> = { method, app_key: c.appKey, timestamp: beijingTime(), format: 'json', v: '2.0', sign_method: 'md5' }
  for (const [k, v] of Object.entries(biz)) if (v !== undefined && v !== null && v !== '') params[k] = typeof v === 'string' ? v : JSON.stringify(v)
  params.sign = topSign(params, c.appSecret)
  let response: Response
  try {
    response = await fetch(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    })
  } catch {
    throw new ServiceUnavailableException('淘宝联盟接口网络连接失败或超时')
  }
  if (!response.ok) throw new ServiceUnavailableException(`淘宝联盟接口 HTTP ${response.status}`)
  const data = (await response.json()) as Record<string, any>
  const err = data.error_response
  if (err) {
    const code = String(err.code ?? ''), sub = String(err.sub_code ?? '')
    const detail = [topHints[code], err.sub_msg || err.msg].filter(Boolean).join('；')
    throw new TopError(code, sub, `淘宝联盟接口拒绝请求（${code}${sub ? '/' + sub : ''}）：${detail}`)
  }
  return data[`${method.replace(/^taobao\./, '').replaceAll('.', '_')}_response`] ?? data
}

const https = (url: unknown) => (typeof url === 'string' && url ? (url.startsWith('//') ? 'https:' + url : url.replace(/^http:/, 'https:')) : null)
const list = (v: any, key: string): any[] => (Array.isArray(v) ? v : Array.isArray(v?.[key]) ? v[key] : v?.[key] ? [v[key]] : [])

export function extractTaobaoUrl(text: string) {
  for (const raw of text.match(/https?:\/\/[^\s<>"'，。！）)】]+/gi) || []) {
    try {
      const url = new URL(raw)
      if (url.username || url.password || url.port) continue
      if (HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return url.toString()
    } catch {}
  }
  throw new Error('请发送淘宝 / 天猫商品链接，或包含 m.tb.cn 链接的分享文案')
}
const idFromUrl = (url: string) => {
  try {
    const u = new URL(url)
    return u.searchParams.get('id') || u.searchParams.get('itemId') || u.searchParams.get('item_id') || /\/i(\d+)\.htm/.exec(u.pathname)?.[1] || null
  } catch {
    return null
  }
}
// 解析商品 ID：直接读取 id 参数；m.tb.cn 等短链请求一次页面，从跳转地址或页面脚本中提取
export async function resolveItemId(url: string) {
  const direct = idFromUrl(url)
  if (direct) return direct
  const host = new URL(url).hostname
  if (!host.endsWith('tb.cn')) return null
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } })
  const location = res.headers.get('location')
  if (location) return idFromUrl(new URL(location, url).toString())
  const html = await res.text()
  return /[?&](?:id|itemId)=(\d{6,})/.exec(html)?.[1] || /"itemId"\s*:\s*"?(\d{6,})/.exec(html)?.[1] || null
}

export function parseItemDetail(resp: any) {
  const item = list(resp?.results, 'tbk_item_detail')[0]
  if (!item) return null
  const basic = item.item_basic_info || {}, price = item.price_promotion_info || {}, income = item.publish_info?.income_info || {}
  const paths = list(price.final_promotion_path_list, 'final_promotion_path_map_data')
  const coupon = paths.filter((p) => /券/.test(String(p.promotion_title || ''))).reduce((sum, p) => sum + (decimalCents(p.promotion_fee) || 0), 0)
  return {
    title: String(basic.title || ''),
    image: https(basic.pict_url),
    price: decimalCents(price.zk_final_price ?? price.reserve_price),
    finalPrice: decimalCents(price.final_promotion_price),
    coupon: paths.length ? coupon : null,
    commission: decimalCents(income.commission_amount),
  }
}
export function parseConvert(resp: any) {
  const row = list(resp?.data?.item_url_list, 'item_url_list')[0] || list(resp?.data, 'item_url_list')[0]
  if (!row) return null
  const link = row.link_info_dto || {}
  return {
    error: row.code && String(row.code) !== '0' ? `${row.code} ${row.msg || ''}`.trim() : row.msg && !link.cps_short_url && !link.coupon_short_url ? String(row.msg) : null,
    url: https(link.coupon_short_url || link.cps_short_url || link.coupon_long_url || link.cps_long_url),
    password: link.coupon_short_tpwd || link.cps_short_tpwd || null,
    coupon: decimalCents(row.coupon_info_dto?.coupon_amount),
    commission: decimalCents(row.income_info?.pure_commission_amount),
  }
}

const tkStatus: Record<string, PlatformOrderStatus> = { '12': 'PAID', '13': 'CANCELLED', '14': 'COMPLETED', '3': 'COMPLETED' }

export const taobaoPlugin: PlatformPlugin = {
  id: 'taobao',
  name: '淘宝',
  accountId: 'taobao-primary',
  documentationUrl: 'https://developer.alibaba.com/docs/api.htm?apiId=65409',
  authentication: { mode: 'app-credentials', description: '使用淘宝联盟推广者应用 AppKey / AppSecret 与推广位 PID。' },
  fields: taobaoFields,
  maxHistoryDays: 90,
  maxWindowMs: 3 * 3600000,
  configured: (c) => !!(c.appKey && c.appSecret && c.pid && c.adzoneId),
  normalizeUrl: extractTaobaoUrl,
  orderStatus: (code) => tkStatus[code] || 'UNATTRIBUTED',
  orderAmounts: () => ({ amount: null, commission: null, commissionBase: null }),
  orderImage: () => null,
  async convert(c, url) {
    if (!c.adzoneId) throw new BadRequestException('尚未保存推广位 PID，请到渠道配置填写')
    const itemId = await resolveItemId(url).catch(() => null)
    if (!itemId) throw new BadRequestException('无法从链接识别淘宝商品，请发送商品详情链接或带 m.tb.cn 链接的分享文案')
    const notices: string[] = []
    let info: ReturnType<typeof parseItemDetail> = null
    try {
      info = parseItemDetail(await topRequest(c, 'taobao.tbk.item.info.upgrade.get', { item_id: itemId }))
      if (!info) notices.push('商品详情接口未返回该商品（可能不在淘宝客推广范围）')
    } catch (e) {
      notices.push(`商品信息：${(e as Error).message}`)
    }
    let converted: ReturnType<typeof parseConvert> = null
    try {
      converted = parseConvert(await topRequest(c, 'taobao.tbk.dg.general.link.convert', { adzone_id: c.adzoneId, item_dto: [{ item_id: itemId }] }))
    } catch (e) {
      const title = info?.title ? `「${info.title}」` : ''
      throw new BadRequestException(`商品${title}转链失败：${(e as Error).message}`)
    }
    if (!converted?.url) throw new BadRequestException(`转链未返回推广链接${converted?.error ? `：${converted.error}` : ''}`)
    let password = converted.password
    if (!password) {
      try {
        const t = await topRequest(c, 'taobao.tbk.tpwd.create', { url: converted.url })
        password = t?.data?.password_simple || null
      } catch (e) {
        notices.push(`淘口令：${(e as Error).message}`)
      }
    }
    return {
      link: converted.url,
      snapshot: {
        product: info?.title || '淘宝商品',
        price: info?.price ?? null,
        imageUrl: info?.image ?? null,
        commission: converted.commission ?? info?.commission ?? null,
        coupon: converted.coupon ?? info?.coupon ?? null,
        payablePrice: info?.finalPrice ?? null,
        password: password || undefined,
        infoMessage: notices.join('；'),
        rebate: null,
        finalPrice: null,
        category: '淘宝商品',
        trackingVerified: false,
      },
    }
  },
  // 依次探测：签名 / 商品详情权限 / 万能转链权限 / 淘口令权限
  async test(c) {
    const probe = async (method: string, biz: Record<string, unknown>) => {
      try {
        await topRequest(c, method, biz)
        return '可用'
      } catch (e) {
        if (e instanceof TopError) {
          if (['25', '29', '27'].includes(e.code)) throw e
          if (e.code === '11' || /permission|权限/i.test(e.subCode + e.message)) return '未开通'
          return '可用'
        }
        throw e
      }
    }
    const detail = await probe('taobao.tbk.item.info.upgrade.get', { item_id: '1' })
    const convert = await probe('taobao.tbk.dg.general.link.convert', { adzone_id: c.adzoneId || '0', item_dto: [{ item_id: '1' }] })
    const tpwd = await probe('taobao.tbk.tpwd.create', { url: 'https://s.click.taobao.com/test' })
    return `签名与 AppKey 验证通过。商品详情：${detail}；万能转链：${convert}；淘口令：${tpwd}${convert === '未开通' ? '。转链需申请「万能转链」相关权限' : ''}`
  },
  async queryOrders() {
    throw new BadRequestException('淘宝订单同步尚未接入，需先开通订单查询权限')
  },
}
