// 淘宝联盟（推广者）插件：TOP 网关 MD5 签名；商品详情、万能转链（按商品 ID）、淘口令生成。
// 文档：taobao.tbk.item.info.upgrade.get / taobao.tbk.dg.general.link.convert / taobao.tbk.tpwd.create
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { decimalCents, parseJdJson } from '../jd'
import type { PlatformConfig, PlatformPlugin } from '../types'
import { dateText } from '../../database'
import { taobaoFields } from './config'
import { queryTaobaoOrders, taobaoOrderAmounts, taobaoOrderImage, taobaoOrderStatus } from './orders'

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
  // 订单号等超过 2^53 的整数按原文保留为字符串
  const data = parseJdJson(await response.text()) as Record<string, any>
  const err = data.error_response
  if (err) {
    const code = String(err.code ?? ''), sub = String(err.sub_code ?? '')
    // 缺权限时写明是哪个接口，方便到开放平台对照申请；scope ids 列表对排查无用，去掉
    const hint = code === '11' ? `${topHints[code]}（接口 ${method}）` : topHints[code]
    const raw = String(err.sub_msg || err.msg || '').replace(/;?\s*scope ids is[\d\s]*$/i, '')
    const detail = [hint, code === '11' ? '' : raw].filter(Boolean).join('；')
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
// fromPage：ID 是从落地页 HTML 里搜出来的（页面里可能有推荐商品、统计脚本等其他 ID），不可靠，不能作为缓存键
export async function resolveShortLink(url: string): Promise<{ itemId: string | null; title: string | null; fromPage?: boolean }> {
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
    return itemId ? { itemId, title: titleFromHtml(html) } : { itemId: idFromText(html), title: titleFromHtml(html), fromPage: true }
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
// 物料搜索（taobao.tbk.dg.material.optional.upgrade，权限包「物料搜索」）：结果自带含推广位的推广链接。
// 同款商品常有多家店铺用相同标题在卖，为避免把 A 店换成 B 店：商品 ID 命中最可靠；
// 标题完全一致时必须只属于一家店铺；标题包含关系只在唯一候选时采用；否则视为无法确定，不转链。
export type MaterialMatch =
  | { status: 'ok'; url: string | null; coupon: number | null; commission: number | null; finalPrice: number | null; price: number | null; shop: string | null; image: string | null; title: string; by: 'id' | 'title' | 'fuzzy' }
  | { status: 'ambiguous'; shops: string[] }
  | { status: 'none' }
export function parseMaterialSearch(rows: any[], itemId: string | null, title: string): MaterialMatch {
  const norm = (t: unknown) => String(t || '').replace(/\s+/g, '')
  const seller = (r: any) => String(r.item_basic_info?.seller_id || r.item_basic_info?.shop_title || r.item_id)
  const shopName = (r: any) => String(r.item_basic_info?.shop_title || '未知店铺')
  const pick = (hit: any, by: 'id' | 'title' | 'fuzzy'): MaterialMatch => {
    const basic = hit.item_basic_info || {}, pub = hit.publish_info || {}, price = hit.price_promotion_info || {}
    const paths = list(price.final_promotion_path_list, 'final_promotion_path_map_data')
    const coupon = paths.filter((p) => /券/.test(String(p.promotion_title || ''))).reduce((sum, p) => sum + (decimalCents(p.promotion_fee) || 0), 0)
    return {
      status: 'ok',
      url: https(pub.coupon_share_url || pub.click_url),
      coupon: paths.length ? coupon : null,
      commission: decimalCents(pub.income_info?.commission_amount),
      finalPrice: decimalCents(price.final_promotion_price),
      price: decimalCents(price.zk_final_price ?? price.reserve_price),
      shop: basic.shop_title ? String(basic.shop_title) : null,
      image: https(basic.pict_url),
      title: String(basic.title || title),
      by,
    }
  }
  const byId = itemId && rows.find((r) => String(r.item_id) === itemId || String(r.item_id).endsWith('-' + itemId))
  if (byId) return pick(byId, 'id')
  const decide = (cands: any[], by: 'title' | 'fuzzy'): MaterialMatch | null => {
    if (!cands.length) return null
    const sellers = new Map<string, any>()
    for (const r of cands) if (!sellers.has(seller(r))) sellers.set(seller(r), r)
    if (sellers.size > 1) return { status: 'ambiguous', shops: [...sellers.values()].map(shopName) }
    if (by === 'fuzzy' && cands.length > 1) return { status: 'ambiguous', shops: [shopName(cands[0])] }
    return pick(cands[0], by)
  }
  const q = norm(title)
  return (
    decide(rows.filter((r) => norm(r.item_basic_info?.title) === q), 'title') ||
    decide(q.length >= 8 ? rows.filter((r) => { const t = norm(r.item_basic_info?.title); return t.length >= 8 && (t.includes(q) || q.includes(t)) }) : [], 'fuzzy') ||
    { status: 'none' }
  )
}
// 推广短链：s.click.taobao.com/xxxx（无查询参数）。物料搜索返回的是很长的 coupon_share_url / click_url，不便复制
export const isShortTaobao = (u: unknown) => typeof u === 'string' && /^https:\/\/s\.click\.taobao\.com\/[A-Za-z0-9]{1,24}$/.test(u)
/** 长链转短链（taobao.tbk.spread.get）；失败或未开通返回 null，由调用方保留原链接 */
export async function shortTaobaoLink(c: PlatformConfig, link: string): Promise<string | null> {
  if (isShortTaobao(link)) return link
  const resp = await topRequest(c, 'taobao.tbk.spread.get', { requests: [{ url: link }] })
  const row = list(resp?.results, 'tbk_spread')[0]
  const short = https(row?.content)
  return isShortTaobao(short) ? short : null
}
export function parseConvert(resp: any) {
  const row = list(resp?.data?.item_url_list, 'item_url_list')[0] || list(resp?.data, 'item_url_list')[0]
  if (!row) return null
  const link = row.link_info_dto || {}
  return {
    error: row.code && String(row.code) !== '0' ? `${row.code} ${row.msg || ''}`.trim() : row.msg && !link.cps_short_url && !link.coupon_short_url ? String(row.msg) : null,
    url: https(link.coupon_short_url || link.cps_short_url || link.coupon_long_url || link.cps_long_url),
    // 优先完整口令（新版手淘对短口令 ￥xxx￥ 常不识别）
    password: link.coupon_full_tpwd || link.cps_full_tpwd || link.coupon_short_tpwd || link.cps_short_tpwd || null,
    coupon: decimalCents(row.coupon_info_dto?.coupon_amount),
    commission: decimalCents(row.income_info?.pure_commission_amount),
  }
}


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
  // orders.ts 与本文件互相引用，用箭头函数延迟取值，避免加载顺序导致未定义
  orderStatus: (code) => taobaoOrderStatus(code),
  orderAmounts: (raw) => taobaoOrderAmounts(raw),
  orderImage: (raw) => taobaoOrderImage(raw),
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
    let shop: string | null = null
    const label = info?.title ? `「${info.title}」` : ''
    try {
      if (!itemId) throw new TopError('11', '', '无商品 ID，跳过万能转链')
      converted = parseConvert(await topRequest(c, 'taobao.tbk.dg.general.link.convert', { adzone_id: c.adzoneId, item_dto: [{ item_id: itemId }] }))
    } catch (e) {
      if (!(e instanceof TopError && e.code === '11')) throw new BadRequestException(`商品${label}转链失败：${(e as Error).message}`)
      // 万能转链为邀约权限；无权限时用「物料搜索」按标题搜索并按商品 ID 匹配，结果中的推广链接已带推广位
      if (!info?.title) throw new BadRequestException(`暂时无法转换这条链接${why()}。请在淘宝 App 点「分享」→「复制链接」，把完整分享文案（含「商品标题」）发过来再试`)
      let found: MaterialMatch = { status: 'none' }
      try {
        // 按标题搜索，最多翻 3 页（每页 100 条），汇总后再判断是否能唯一确定同一商品
        const rows: any[] = []
        for (let page = 1; page <= 3; page++) {
          const resp = await topRequest(c, 'taobao.tbk.dg.material.optional.upgrade', { adzone_id: c.adzoneId, q: info.title.slice(0, 60), page_no: page, page_size: 100 })
          const batch = list(resp?.result_list, 'map_data')
          rows.push(...batch)
          if (batch.length < 100) break
        }
        found = parseMaterialSearch(rows, info.itemId || itemId, info.title)
      } catch (err) {
        if (err instanceof TopError && err.code === '11')
          throw new BadRequestException('淘宝转链需要「物料搜索」或「万能转链」权限，当前应用两者都未开通。请在淘宝联盟开放平台申请物料搜索权限（taobao.tbk.dg.material.optional.upgrade）')
        throw new BadRequestException(`商品${label}转链失败（物料搜索）：${(err as Error).message}`)
      }
      if (found.status === 'ambiguous') {
        const shops = [...new Set(found.shops)]
        throw new BadRequestException(
          shops.length > 1
            ? `商品${label}有 ${shops.length} 家店铺在卖同名商品（${shops.slice(0, 3).join('、')}${shops.length > 3 ? ' 等' : ''}），无法确定你看到的是哪一家。为避免换成别家店铺的商品，本次不转链`
            : `商品${label}按标题匹配到多个相近商品，无法确定是哪一个，为避免转错本次不转链`,
        )
      }
      if (found.status !== 'ok' || !found.url) throw new BadRequestException(`商品${label}暂无法转链：物料搜索未找到该商品${why()}`)
      converted = { error: null, url: found.url, password: null, coupon: found.coupon, commission: found.commission }
      if (found.finalPrice != null && info.finalPrice == null) info.finalPrice = found.finalPrice
      if (info.price == null) info.price = found.price
      if (!info.image) info.image = found.image
      shop = found.shop
      notices.push('已通过物料搜索转链')
    }
    if (!converted?.url) throw new BadRequestException(`转链未返回推广链接${converted?.error ? `：${converted.error}` : ''}`)
    // 物料搜索返回的长链转成 s.click.taobao.com 短链，便于复制；转不了时保留原链接
    const promoUrl: string = (isShortTaobao(converted.url) ? null : await shortTaobaoLink(c, converted.url).catch(() => null)) || converted.url
    let password = converted.password
    if (!password) {
      try {
        const t = await topRequest(c, 'taobao.tbk.tpwd.create', { url: promoUrl })
        password = t?.data?.model || t?.data?.password_simple || null
      } catch (e) {
        notices.push(`淘口令：${(e as Error).message}`)
      }
    }
    return {
      link: promoUrl,
      snapshot: {
        product: info?.title || '淘宝商品',
        price: info?.price ?? null,
        imageUrl: info?.image ?? null,
        commission: converted.commission ?? info?.commission ?? null,
        coupon: converted.coupon ?? info?.coupon ?? null,
        payablePrice: info?.finalPrice ?? null,
        password: password || undefined,
        infoMessage: notices.join('；'),
        shop: shop || undefined,
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
    const spread = await probe('taobao.tbk.spread.get', { requests: [{ url: 'https://uland.taobao.com/' }] })
    const now = new Date()
    const orders = await probe('taobao.tbk.order.details.get', { query_type: '4', start_time: dateText(new Date(now.getTime() - 3600000)), end_time: dateText(now), page_size: '1' })
    const route = convert === '可用' ? '转链方式：万能转链' : search === '可用' ? '转链方式：物料搜索（万能转链为邀约权限，未开通不影响使用）' : '无可用转链权限，需申请「物料搜索」或「万能转链」'
    return `签名与 AppKey 验证通过。商品详情：${detail}；物料搜索：${search}；万能转链：${convert}；淘口令：${tpwd}；长链转短链：${spread}；订单查询：${orders === '可用' ? '可用' : '未开通（将改用喵有券查询，需配置「淘宝联盟 · 喵有券」）'}。${route}`
  },
  queryOrders: (c, request) => queryTaobaoOrders(c, request),
}
