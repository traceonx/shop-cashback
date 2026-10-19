import { BadRequestException } from '@nestjs/common'
import type { PlatformConfig, PlatformPlugin } from '../types'
import { ecapiCall } from '../jd/ecapi'
import { parseMaterialSearch, resolveShortLink, shareTitle, topRequest } from './index'

/**
 * 淘宝第三方接入：喵有券（ecapi.cn）+ 淘宝官方混合转链。
 * 官方应用没有万能转链 / 万能解析权限，无法把分享链接里的数字商品 ID 换成新版联盟商品 ID，
 * 只能靠标题搜索，同款多店时无法确定原商品。混合流程：
 *   1. 喵有券万能转链 doTbHighCommissionPromotionUrl：传原分享文案 / 淘口令，取得推广淘口令（可能直接带新版 ID）
 *   2. 喵有券万能解析 doCommonPromotionUrlParse：解析推广淘口令，取得新版联盟商品 ID
 *   3. 官方物料搜索 q=uland 商品链接：按新版 ID 精确命中，取价格、优惠、预计佣金和官方推广链接
 * 每个新商品 2 次喵有券调用 + 1 次官方调用；数字 ID → 新版 ID 缓存 24 小时，重复商品只调官方。
 * 文档：https://www.ecapi.cn/index/index/openapi/id/330.shtml、id/346.shtml
 */
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
const idCache = new Map<string, { id: string; at: number }>()
function cached(key: string | null) {
  if (!key) return null
  const hit = idCache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.id
  idCache.delete(key)
  return null
}
function remember(key: string | null, id: string) {
  if (!key) return
  if (idCache.size >= 2000) idCache.delete(idCache.keys().next().value!)
  idCache.set(key, { id, at: Date.now() })
}
export const clearTbIdCache = () => idCache.clear()

const auth = (t: PlatformConfig, official: PlatformConfig) => ({ apkey: t.apiKey.trim(), tbname: t.tbname.trim(), pid: official.pid })

/** 步骤 1 + 2：用喵有券取得推广链接 / 淘口令和新版商品 ID */
async function promote(t: PlatformConfig, official: PlatformConfig, material: string) {
  const data = await ecapiCall('taoke/doTbHighCommissionPromotionUrl', { ...auth(t, official), material_list: material })
  const row = rowsOf(data?.material_url_list, 'material_url_list')[0] || rowsOf(data?.item_url_list, 'item_url_list')[0]
  if (!row) throw new BadRequestException('喵有券万能转链未返回结果')
  if (row.code != null && !['0', '200'].includes(String(row.code)))
    throw new BadRequestException(`喵有券万能转链未成功：${String(row.msg || row.code).slice(0, 80)}`)
  const link = row.link_info_dto || {}
  const url = https(link.coupon_short_url || link.cps_short_url || link.coupon_long_url || link.cps_long_url)
  const tpwd: string | null = link.coupon_short_tpwd || link.cps_short_tpwd || link.coupon_full_tpwd || link.cps_full_tpwd || null
  let newId = Number(link.material_type ?? 1) === 1 && isNewId(link.material_id) ? String(link.material_id) : null
  if (!newId && (tpwd || url)) {
    const parsed = await ecapiCall('taoke/doCommonPromotionUrlParse', { ...auth(t, official), material_url: tpwd || url! })
    const id = rowsOf(parsed, 'data')[0]?.link_info_dto?.material_id
    if (isNewId(id)) newId = String(id)
  }
  return { url, tpwd, newId }
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
  const numericId = (await resolveShortLink(url).catch(() => ({ itemId: null }))).itemId
  const material = (content || url).replace(/\s+/g, ' ').trim().slice(0, 500)
  let promo: Awaited<ReturnType<typeof promote>> | null = null
  let newId = cached(numericId)
  let found: Awaited<ReturnType<typeof officialById>> = null
  const viaEcapi = async () => {
    promo = await promote(t, official, material)
    newId = promo.newId
    if (newId) remember(numericId, newId)
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
  } else notices.push('喵有券未解析出新版商品 ID')
  const p = promo as Awaited<ReturnType<typeof promote>> | null
  let link: string | null, password: string | null
  if (found) {
    link = found.url
    password = null
  } else if (p?.url) {
    // 官方未命中：用喵有券推广链接兜底，价格和佣金口径不同，不展示预计返现
    link = p.url
    password = p.tpwd
    notices.push('未取到官方价格与佣金，已使用喵有券推广链接')
  } else throw new BadRequestException(`商品${title ? `「${title}」` : ''}暂无法转链${notices.length ? `（${notices.join('；')}）` : ''}`)
  if (!password) {
    try {
      const r = await topRequest(official, 'taobao.tbk.tpwd.create', { url: link })
      password = r?.data?.password_simple || null
    } catch (e) {
      notices.push(`淘口令：${(e as Error).message}`)
    }
  }
  return {
    link: link!,
    snapshot: {
      product: found?.title || title || '淘宝商品',
      price: found?.price ?? null,
      imageUrl: found?.image ?? null,
      commission: found?.commission ?? null,
      coupon: found?.coupon ?? null,
      payablePrice: found?.finalPrice ?? null,
      password: password || undefined,
      infoMessage: notices.join('；'),
      shop: found?.shop || undefined,
      rebate: null,
      finalPrice: null,
      category: '淘宝商品',
      trackingVerified: false,
    },
  }
}

export async function tbEcapiTest(t: PlatformConfig) {
  const list = rowsOf(await ecapiCall('taoke/getTbAuthList', { apkey: t.apiKey.trim() }), 'data')
  const hit = list.find((v: any) => String(v?.tbname) === t.tbname.trim())
  if (!hit)
    throw new BadRequestException(
      `喵有券授权列表中没有「${t.tbname.trim()}」，请先在喵有券「账号授权」中授权该淘宝账号（当前已授权：${list.map((v: any) => v?.tbname).filter(Boolean).join('、') || '无'}）`,
    )
  const expire = hit.auth_expire_date ? `，授权到期 ${String(hit.auth_expire_date).slice(0, 19)}` : ''
  return `喵有券接口可用，淘宝账号「${hit.tbname}」已授权${expire}。${t.enabled === 'true' ? '淘宝链接将走喵有券 + 官方混合转链。' : '当前未启用，淘宝链接仍走官方接入。'}`
}
