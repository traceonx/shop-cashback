import { BadRequestException } from '@nestjs/common'
import type { PlatformConfig, PlatformPlugin } from '../types'
import { ecapiCall } from '../jd/ecapi'
import { decimalCents } from '../jd'
import { isShortTaobao, parseMaterialSearch, resolveShortLink, shareTitle, shortTaobaoLink, topRequest } from './index'

/** 淘宝 V0 免费转链：淘口令 / 商品 ID 转链；仅返回新版 ID 时配合官方物料查询，不调用付费解析。 */
export const TB_ECAPI_KIND = 'taobao-ecapi'
export const tbEcapiFields = [
  ['enabled', '启用', false],
  ['apiKey', '喵有券 apkey', true],
  ['tbname', '喵有券已授权的淘宝用户名', false],
] as const
export const tbEcapiConfigured = (c: PlatformConfig) => !!(c.apiKey?.trim() && c.tbname?.trim())
export const tbEcapiEnabled = (c: PlatformConfig) => c.enabled === 'true' && tbEcapiConfigured(c)

const https = (url: unknown) =>
  typeof url === 'string' && url ? (url.startsWith('//') ? 'https:' + url : url.replace(/^http:/, 'https:')) : null
const rowsOf = (v: any, key: string): any[] =>
  Array.isArray(v) ? v : Array.isArray(v?.[key]) ? v[key] : v?.[key] ? [v[key]] : v && typeof v === 'object' ? [v] : []
// 新版联盟商品 ID 为字母数字混合（如 oQa8py...-0eQa5...），纯数字为旧 ID，官方已不接受
const isNewId = (v: unknown) => typeof v === 'string' && /[A-Za-z]/.test(v) && /^[\w-]{8,80}$/.test(v)

const TTL = 24 * 3600000
// 数字 ID → 新版 ID，以及喵有券给出的推广短链（官方长链转短链不可用时兜底）
// 推广短链与生成它的 PID 绑定：每个用户有自己的推广位时，不能把 A 的短链给 B
const idCache = new Map<string, { id: string; short: string | null; pid: string; at: number }>()
function cached(key: string | null) {
  if (!key) return null
  const hit = idCache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit
  idCache.delete(key)
  return null
}
function remember(key: string | null, id: string, short: string | null, pid: string) {
  if (!key) return
  if (idCache.size >= 2000) idCache.delete(idCache.keys().next().value!)
  idCache.set(key, { id, short, pid, at: Date.now() })
}
export const clearTbIdCache = () => idCache.clear()

const auth = (t: PlatformConfig, official: PlatformConfig) => ({ apkey: t.apiKey.trim(), tbname: t.tbname.trim(), pid: official.pid })

/** 只读取本次转链商品的数据，不将划线价当售价；金额均为整数分。 */
export function freeItemInfo(row: any, now = Date.now()) {
  const item = row?.item_info || {}
  const sameItem = row?.item_id == null || item.num_iid == null || String(row.item_id) === String(item.num_iid)
  const price = sameItem ? decimalCents(item.zk_final_price) : null
  let coupon: number | null = null, payablePrice: number | null = null
  const noCoupon = row?.has_coupon === false || row?.has_coupon === 'false'
  if (noCoupon) { coupon = 0; payablePrice = price }
  else if (row?.has_coupon === true || row?.has_coupon === 'true') {
    const amount = decimalCents(row.youhuiquan), quota = decimalCents(row.quanlimit)
    // 日期字段为北京时间自然日；未知或过期的券不据此估算实付金额。
    const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10)
    const start = row.coupon_start_time, end = row.coupon_end_time
    const valid = (!start || /^\d{4}-\d{2}-\d{2}$/.test(start) && start <= today) &&
      (!end || /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= today)
    if (amount !== null && valid) {
      coupon = amount
      if (price !== null && quota !== null) {
        if (price >= quota && amount <= price) payablePrice = price - amount
        else if (price < quota) { coupon = 0; payablePrice = price }
      }
    }
  }
  const rate = String(row?.max_commission_rate ?? '')
  let commission: number | null = null
  // 百分比保留六位小数，用整数运算向下取分；不把百分比当佣金金额。
  if (payablePrice !== null && /^\d{1,3}(\.\d{1,6})?$/.test(rate)) {
    const [whole, fraction = ''] = rate.split('.')
    const units = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))
    if (units <= 100000000n) commission = Number(BigInt(payablePrice) * units / 100000000n)
  }
  const image = sameItem ? https(item.pict_url) : null
  return {
    title: sameItem && typeof item.title === 'string' ? item.title : null,
    image: image && /^https:\/\//.test(image) ? image : null,
    shop: sameItem && typeof item.nick === 'string' ? item.nick : null,
    price, coupon, payablePrice, commission,
  }
}

/** 免费转链可直接携带商品信息，不要求先取得新版 ID。 */
async function promote(t: PlatformConfig, official: PlatformConfig, material: string, numericId?: string | null) {
  const token = /[￥¥]\s*([A-Za-z0-9]{6,30})\s*[￥¥]/.exec(material)?.[1] || /[?&]tk=([A-Za-z0-9]{6,30})/.exec(material)?.[1]
  if (!token && !numericId) throw new BadRequestException('免费转链需要淘口令或明确的商品 ID，请发送完整淘宝分享文案')
  const method = token ? 'doItemHighCommissionPromotionLinkByTpwd' : 'doItemHighCommissionPromotionLink'
  const data = await ecapiCall('taoke/' + method, {
    ...auth(t, official), ...(token ? { tpwdcode: '￥' + token + '￥' } : { itemid: numericId! }),
    shorturl: '1', tpwd: '1', hasiteminfo: '1',
  })
  const row = Array.isArray(data) ? data[0] : data
  const url = https(row?.short_url || row?.coupon_click_url || row?.item_url)
  if (!url) throw new BadRequestException('喵有券免费转链未返回推广链接')
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username || target.password || target.port ||
      !/(^|\.)(taobao\.com|tmall\.com|tb\.cn)$/.test(target.hostname))
    throw new BadRequestException('喵有券未返回有效的淘宝推广链接')
  const newId = isNewId(row.item_id) ? String(row.item_id) : null
  const tpwd = typeof row.tpwd === 'string' ? row.tpwd : null
  let goods = freeItemInfo(row)
  // 部分免费转链响应不包含 item_info，再用免费物料查询补充。
  // 只按转链实际返回的商品 ID 匹配，不按标题或单条搜索结果认领商品。
  if (goods.price === null && row.item_id != null) {
    try {
      const result = await ecapiCall('taoke/getTkMaterialItem', {
        ...auth(t, official), keyword: url, pagesize: '20', pageno: '1',
      })
      const rows = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : []
      const exact = rows.filter((v: any) => v?.item_id != null && String(v.item_id) === String(row.item_id))
      if (exact.length === 1) {
        const v = exact[0]
        // 保留转链接口的券与佣金口径，查询结果只补同一商品的基础信息。
        goods = freeItemInfo({ ...row, item_info: { ...v, num_iid: row.item_id, nick: v.shop_title } })
      }
    } catch { /* 补充信息失败不阻止已经成功的转链 */ }
  }
  return { url, tpwd, fullTpwd: tpwd, newId, goods }
}

/** 步骤 3：官方物料搜索按新版 ID 精确命中 */
async function officialById(official: PlatformConfig, newId: string, title: string) {
  const resp = await topRequest(official, 'taobao.tbk.dg.material.optional.upgrade', {
    adzone_id: official.adzoneId,
    q: `https://uland.taobao.com/item/edetail?id=${newId}`,
    biz_scene_id: '1',
    page_no: 1,
    page_size: 20,
  })
  const rows = rowsOf(resp?.result_list, 'map_data')
  // q 是含新版 ID 的商品链接，单条结果即为该链接对应的商品。
  // 联盟会重新生成动态 ID，不能要求返回 ID 与输入 ID 字符串相等。
  // 多条结果仍执行原有匹配，不将关键词搜索候选误当成原商品。
  const matchId = rows.length === 1 && isNewId(rows[0]?.item_id) ? String(rows[0].item_id) : newId
  const found = parseMaterialSearch(rows, matchId, title)
  return found.status === 'ok' && found.by === 'id' && found.url ? found : null
}

export async function tbHybridConvert(
  official: PlatformConfig,
  t: PlatformConfig,
  url: string,
  content?: string,
): ReturnType<PlatformPlugin['convert']> {
  if (!official.pid || !official.adzoneId) throw new BadRequestException('请先在淘宝联盟（官方）配置中保存推广位 PID')
  const notices: string[] = []
  const title = shareTitle(content) || ''
  const resolved = await resolveShortLink(url).catch(() => ({ itemId: null, fromPage: true }))
  // 缓存键：链接跳转中拿到的数字 ID 才可靠；否则按分享短链本身缓存（不同分享链接互不影响），避免把 A 商品的结果返回给 B 链接
  const numericId = resolved.itemId && !resolved.fromPage ? `id:${resolved.itemId}` : `link:${url.split(/[?#]/)[0]}`
  const material = (content || url).replace(/\s+/g, ' ').trim().slice(0, 500)
  let promo: Awaited<ReturnType<typeof promote>> | null = null
  const hit = cached(numericId)
  let newId = hit?.id ?? null
  let ecapiShort = hit && hit.pid === official.pid ? hit.short : null
  let found: Awaited<ReturnType<typeof officialById>> = null
  const viaEcapi = async () => {
    promo = await promote(t, official, material, resolved.fromPage ? null : resolved.itemId)
    newId = promo.newId
    ecapiShort = isShortTaobao(promo.url) ? promo.url : null
    if (newId) remember(numericId, newId, ecapiShort, official.pid)
  }
  if (!newId) await viaEcapi()
  if (newId) {
    try {
      found = await officialById(official, newId, title)
    } catch (e) {
      notices.push(`官方物料查询：${(e as Error).message}`)
    }
    // 缓存的 ID 查不到时（商品变动），重新走喵有券
    if (!found && !promo) {
      await viaEcapi()
      if (newId) found = await officialById(official, newId, title).catch(() => null)
    }
  }
  const p = promo as Awaited<ReturnType<typeof promote>> | null
  let link: string | null, password: string | null
  if (found) {
    link = found.url
    password = null
  } else if (p?.url) {
    // 官方未命中：使用本次免费转链响应，避免混用其他商品的金额。
    link = p.url
    password = p.fullTpwd
    notices.push('已使用喵有券推广链接与免费商品信息，金额为预估，以结算订单为准')
    if (p.goods.price === null || p.goods.commission === null) notices.push('免费接口的商品信息或计佣条件不完整，缺失金额待确认')
  } else throw new BadRequestException(`商品${title ? `「${title}」` : ''}暂无法转链${notices.length ? `（${notices.join('；')}）` : ''}`)
  // 官方物料链接很长，转成 s.click.taobao.com 短链；官方转短链不可用时用喵有券的推广短链（同一 PID）
  if (!isShortTaobao(link)) {
    const short = (await shortTaobaoLink(official, link!).catch(() => null)) || ecapiShort
    if (short) link = short
  }
  if (!password) {
    try {
      const r = await topRequest(official, 'taobao.tbk.tpwd.create', { url: link })
      password = r?.data?.model || r?.data?.password_simple || null
    } catch (e) {
      notices.push(`淘口令：${(e as Error).message}`)
    }
  }
  return {
    link: link!,
    snapshot: {
      product: found?.title || p?.goods.title || title || '淘宝商品',
      // 新版商品 ID，用于订单按商品匹配下单用户
      sku: newId || undefined,
      price: found ? found.price : p?.goods.price ?? null,
      imageUrl: found ? found.image : p?.goods.image ?? null,
      commission: found ? found.commission : p?.goods.commission ?? null,
      coupon: found ? found.coupon : p?.goods.coupon ?? null,
      payablePrice: found ? found.finalPrice : p?.goods.payablePrice ?? null,
      password: password || undefined,
      infoMessage: notices.join('；'),
      shop: (found ? found.shop : p?.goods.shop) || undefined,
      rebate: null,
      finalPrice: null,
      category: '淘宝商品',
      trackingVerified: false,
    },
  }
}

export async function tbEcapiTest(t: PlatformConfig) {
  const { readConfig } = await import('../../integrations')
  const c = await readConfig('taobao')
  if (!c.pid) throw new BadRequestException('请先保存淘宝联盟默认 PID')
  await ecapiCall('taoke/getTkMaterialItem', { ...auth(t, c), keyword: '眼镜', pageno: '1', pagesize: '1' })
  return '喵有券免费商品查询接口可用；淘宝转链仅使用免费淘口令 / 商品 ID 接口，订单请使用官方或网页登录通道。'
}
