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
// 在任意文本（含多层 URL 编码的跳转参数，如 redirectURL=...%3Fid%3D123）中找商品 ID
export function idFromText(text: string): string | null {
  let t = text
  for (let i = 0; i < 3; i++) {
    const hit =
      /(?:[?&]|\b)(?:id|itemId|item_id)=(\d{6,})/.exec(t)?.[1] ||
      /\/i(\d{6,})\.htm/.exec(t)?.[1] ||
      /"(?:itemId|item_id|itemid)"\s*:\s*"?(\d{6,})/.exec(t)?.[1]
    if (hit) return hit
    try {
      const next = decodeURIComponent(t)
      if (next === t) break
      t = next
    } catch {
      break
    }
  }
  return null
}
// 分享文案里「」中的商品标题（如：【淘宝】https://e.tb.cn/h.xxx CZ321 「商品标题」）
export function shareTitle(content?: string) {
  const t = /「([^「」]{4,120})」/.exec(content || '')?.[1]?.trim()
  return t || null
}
// 短链落地页中的商品标题（<title> / og:title / "title":"..."），过滤登录、风控等通用标题
export function titleFromHtml(html: string): string | null {
  const cands = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1],
    /"(?:itemTitle|title)"\s*:\s*"([^"]{6,120})"/.exec(html)?.[1],
    /<title>([^<]{6,120})<\/title>/i.exec(html)?.[1],
  ]
  for (const raw of cands) {
    const t = raw?.replace(/[-_|–—]\s*(手机)?(淘宝网?|天猫|tmall\.com|Tmall).*$/i, '').trim()
    if (t && t.length >= 6 && !/登录|验证|安全|跳转|淘宝网 - 淘！我喜欢|^淘宝$/.test(t)) return t
  }
  return null
}
// 解析短链：m.tb.cn / e.tb.cn / c.tb.cn 逐跳请求（最多 3 跳），从跳转地址或页面中取商品 ID 与标题
export async function resolveShortLink(url: string): Promise<{ itemId: string | null; title: string | null }> {
  const direct = idFromUrl(url)
  if (direct) return { itemId: direct, title: null }
  if (!new URL(url).hostname.endsWith('tb.cn')) return { itemId: null, title: null }
  let current = url
  let itemId: string | null = null
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } })
    const location = res.headers.get('location')
    if (location) {
      const next = new URL(location, current).toString()
      itemId = itemId || idFromUrl(next) || idFromText(next)
      if (!new URL(next).hostname.endsWith('tb.cn')) return { itemId, title: null } // 已跳到商品 / 登录页，不再继续
      current = next
      continue
    }
    const html = await res.text()
    return { itemId: itemId || idFromText(html), title: titleFromHtml(html) }
  }
  return { itemId, title: null }
}
export async function resolveItemId(url: string) {
  return (await resolveShortLink(url)).itemId
}

export function parseItemDetail(resp: any) {
  const item = list(resp?.results, 'tbk_item_detail')[0]
  if (!item) return null
  const basic = item.item_basic_info || {}, price = item.price_promotion_info || {}, income = item.publish_info?.income_info || {}
  const paths = list(price.final_promotion_path_list, 'final_promotion_path_map_data')
  const coupon = paths.filter((p) => /券/.test(String(p.promotion_title || ''))).reduce((sum, p) => sum + (decimalCents(p.promotion_fee) || 0), 0)
  return {
    itemId: item.item_id != null ? String(item.item_id) : null,
    title: String(basic.title || ''),
    image: https(basic.pict_url),
    price: decimalCents(price.zk_final_price ?? price.reserve_price),
    finalPrice: decimalCents(price.final_promotion_price),
    coupon: paths.length ? coupon : null,
    commission: decimalCents(income.commission_amount),
  }
}
// 物料搜索（taobao.tbk.dg.material.optional.upgrade，权限包「物料搜索」）：结果自带含推广位的推广链接
export function parseMaterialSearch(resp: any, itemId: string | null, title: string) {
  const rows = list(resp?.result_list, 'map_data')
  const norm = (t: unknown) => String(t || '').replace(/\s+/g, '')
  const hit =
    (itemId && rows.find((r) => String(r.item_id) === itemId || String(r.item_id).endsWith('-' + itemId))) ||
    rows.find((r) => norm(r.item_basic_info?.title) === norm(title)) ||
    // 分享文案中的标题可能被截断或略有出入：最后按标题包含关系匹配
    (rows.find((r) => { const t = norm(r.item_basic_info?.title); const q = norm(title); return q.length >= 8 && (t.includes(q) || q.includes(t)) })) ||
    null
  if (!hit) return null
  const pub = hit.publish_info || {}, price = hit.price_promotion_info || {}
  const paths = list(price.final_promotion_path_list, 'final_promotion_path_map_data')
  const coupon = paths.filter((p) => /券/.test(String(p.promotion_title || ''))).reduce((sum, p) => sum + (decimalCents(p.promotion_fee) || 0), 0)
  return {
    url: https(pub.coupon_share_url || pub.click_url),
    coupon: paths.length ? coupon : null,
    commission: decimalCents(pub.income_info?.commission_amount),
    finalPrice: decimalCents(price.final_promotion_price),
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
  async convert(c, url, _trackingCode, content) {
    if (!c.adzoneId) throw new BadRequestException('尚未保存推广位 PID，请到渠道配置填写')
    const link = await resolveShortLink(url).catch(() => ({ itemId: null, title: null }))
    const itemId = link.itemId
    const sharedTitle = shareTitle(content) || link.title
    if (!itemId && !sharedTitle) throw new BadRequestException('无法从链接识别淘宝商品，请发送商品详情链接或完整的淘宝分享文案')
    const notices: string[] = []
    let info: ReturnType<typeof parseItemDetail> = null
    if (itemId) {
      try {
        info = parseItemDetail(await topRequest(c, 'taobao.tbk.item.info.upgrade.get', { item_id: itemId }))
        if (!info) notices.push('商品详情接口未返回该商品')
      } catch (e) {
        // 淘宝联盟已不接受数字商品 ID（-4003，需升级后的新商品 ID），此时只能按标题搜索
        if (e instanceof TopError && /4003/.test(e.subCode + e.message)) notices.push('淘宝联盟已不支持用链接中的数字商品 ID 查询')
        else notices.push(`商品详情：${(e as Error).message}`)
      }
    } else notices.push('短链未解析出商品 ID，按分享标题搜索')
    // 详情接口拿不到时，用分享文案中的标题兜底（用于展示与物料搜索）
    if (!info && sharedTitle) info = { itemId, title: sharedTitle, image: null, price: null, finalPrice: null, coupon: null, commission: null }
    const why = () => (notices.length ? `（${notices.join('；')}）` : '')
    let converted: ReturnType<typeof parseConvert> = null
    const label = info?.title ? `「${info.title}」` : ''
    try {
      if (!itemId) throw new TopError('11', '', '无商品 ID，跳过万能转链')
      converted = parseConvert(await topRequest(c, 'taobao.tbk.dg.general.link.convert', { adzone_id: c.adzoneId, item_dto: [{ item_id: itemId }] }))
    } catch (e) {
      if (!(e instanceof TopError && e.code === '11')) throw new BadRequestException(`商品${label}转链失败：${(e as Error).message}`)
      // 万能转链为邀约权限；无权限时用「物料搜索」按标题搜索并按商品 ID 匹配，结果中的推广链接已带推广位
      if (!info?.title) throw new BadRequestException(`暂时无法转换这条链接${why()}。请在淘宝 App 点「分享」→「复制链接」，把完整分享文案（含「商品标题」）发过来再试`)
      let found: ReturnType<typeof parseMaterialSearch> = null
      try {
        // 按标题搜索，最多翻 3 页（每页 100 条）找到同一商品
        for (let page = 1; page <= 3 && !found; page++) {
          const resp = await topRequest(c, 'taobao.tbk.dg.material.optional.upgrade', { adzone_id: c.adzoneId, q: info.title.slice(0, 60), page_no: page, page_size: 100 })
          found = parseMaterialSearch(resp, info.itemId || itemId, info.title)
          if (list(resp?.result_list, 'map_data').length < 100) break
        }
      } catch (err) {
        throw new BadRequestException(`商品${label}转链失败（物料搜索）：${(err as Error).message}`)
      }
      if (!found?.url) throw new BadRequestException(`商品${label}暂无法转链：物料搜索未找到该商品${why()}`)
      converted = { error: null, url: found.url, password: null, coupon: found.coupon, commission: found.commission }
      if (found.finalPrice != null && info.finalPrice == null) info.finalPrice = found.finalPrice
      notices.push('已通过物料搜索转链')
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
    const search = await probe('taobao.tbk.dg.material.optional.upgrade', { adzone_id: c.adzoneId || '0', q: '测试', page_size: 1 })
    const route = convert === '可用' ? '转链方式：万能转链' : search === '可用' ? '转链方式：物料搜索（万能转链为邀约权限，未开通不影响使用）' : '无可用转链权限，需申请「物料搜索」或「万能转链」'
    return `签名与 AppKey 验证通过。商品详情：${detail}；物料搜索：${search}；万能转链：${convert}；淘口令：${tpwd}。${route}`
  },
  async queryOrders() {
    throw new BadRequestException('淘宝订单同步尚未接入，需先开通订单查询权限')
  },
}
