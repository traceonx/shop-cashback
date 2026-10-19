// 淘宝联盟推广订单：官方 taobao.tbk.order.details.get（推广者所有订单查询）；
// 应用未开通订单权限（错误码 11）时，若配置了「淘宝联盟 · 喵有券」，改用喵有券 tbkOrderDetailsGet（字段与官方一致）。
import { BadRequestException } from '@nestjs/common'
import { dateText } from '../../database'
import { decimalCents } from '../jd'
import { ecapiCall } from '../jd/ecapi'
import type { PlatformConfig, PlatformOrder, PlatformOrderStatus } from '../types'
import { TopError, topRequest } from './index'

const tkStatus: Record<string, PlatformOrderStatus> = { '12': 'PAID', '13': 'CANCELLED', '14': 'COMPLETED', '3': 'COMPLETED' }
export const taobaoOrderStatus = (code: string) => tkStatus[code] || 'UNATTRIBUTED'

const list = (v: any, key: string): any[] => (Array.isArray(v) ? v : Array.isArray(v?.[key]) ? v[key] : v?.[key] ? [v[key]] : [])
const cents = (v: unknown) => (v == null || v === '' ? null : decimalCents(String(v)))
// 淘宝订单时间为北京时间 yyyy-MM-dd HH:mm:ss
export function taobaoDate(value: unknown): Date | null {
  const raw = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return null
  const d = new Date(raw.replace(' ', 'T') + '+08:00')
  return Number.isNaN(d.getTime()) ? null : d
}

/** 金额口径：付款金额 = alipay_total_price（不含运费）；结算后佣金取 pub_share_fee，失效为 0，其余取付款预估 pub_share_pre_fee */
export function taobaoOrderAmounts(value: unknown) {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const status = String(raw.tk_status ?? '')
  const paid = cents(raw.alipay_total_price)
  const unit = cents(raw.item_price),
    num = Number(raw.item_num)
  const total = unit !== null && Number.isSafeInteger(num) && num > 0 ? unit * num : null
  return {
    amount: paid ?? total,
    commission: status === '13' ? 0 : status === '3' ? (cents(raw.pub_share_fee) ?? cents(raw.pub_share_pre_fee)) : cents(raw.pub_share_pre_fee),
    commissionBase: paid,
  }
}
export function taobaoOrderImage(value: unknown): string | null {
  const img = (value as { item_img?: unknown } | null)?.item_img
  if (typeof img !== 'string' || !img) return null
  try {
    const u = new URL(img.startsWith('//') ? 'https:' + img : img)
    if (!['http:', 'https:'].includes(u.protocol) || !/(^|\.)(alicdn\.com|taobaocdn\.com)$/.test(u.hostname) || u.username || u.password || u.port) return null
    u.protocol = 'https:'
    return u.toString()
  } catch {
    return null
  }
}

export function normalizeTaobaoOrder(raw: any): PlatformOrder {
  const orderId = raw?.trade_parent_id != null ? String(raw.trade_parent_id) : ''
  const lineId = raw?.trade_id != null ? String(raw.trade_id) : ''
  if (!/^\d+$/.test(orderId) || !/^\d+$/.test(lineId)) throw new BadRequestException('淘宝订单号不可靠，已停止导入')
  const placedAt = taobaoDate(raw.tk_create_time)
  const amounts = taobaoOrderAmounts(raw)
  const base = amounts.commissionBase ?? amounts.amount
  if (!placedAt || base === null) throw new BadRequestException('淘宝订单金额或时间格式无法确认，已停止导入')
  const status = String(raw.tk_status ?? 'UNKNOWN')
  const num = Number(raw.item_num)
  return {
    // 未接入渠道 ID（relation_id）前没有可靠的用户标识，订单进入待人工关联
    trackingCode: null,
    status: taobaoOrderStatus(status),
    orderId,
    lineId,
    rawStatus: status,
    raw,
    placedAt,
    completedAt: status === '3' ? taobaoDate(raw.tk_earning_time) : null,
    commissionCents: amounts.commission,
    commissionBaseCents: base,
    sku: raw.item_id != null ? String(raw.item_id) : '',
    title: String(raw.item_title || '商品信息待确认'),
    quantity: Number.isSafeInteger(num) && num > 0 ? num : 1,
  }
}

// 翻页位点：第 2 页起需回传上一页的 position_index；按查询窗口在内存中暂存（进程重启后从无位点的页码继续）
const positions = new Map<string, string>()
// 官方订单权限缺失时，1 小时内直接走喵有券，避免每次先失败一次
let officialDeniedAt = 0

export async function queryTaobaoOrders(
  c: PlatformConfig,
  request: { from: Date; until: Date; page: number; type: 1 | 3 },
): Promise<{ rows: PlatformOrder[]; hasMore: boolean }> {
  const key = `${request.type}:${request.from.getTime()}:${request.until.getTime()}`
  if (request.page === 1) positions.delete(key)
  const params = {
    query_type: String(request.type === 3 ? 4 : 1), // 1 按创建时间（历史回补）；4 按更新时间（最近一小时更新）
    start_time: dateText(request.from),
    end_time: dateText(request.until),
    page_no: String(request.page),
    page_size: '100',
    order_scene: '1',
    jump_type: '1',
    position_index: request.page > 1 ? positions.get(key) : undefined,
  }
  let data: any
  if (Date.now() - officialDeniedAt > 3600000) {
    try {
      const r = await topRequest(c, 'taobao.tbk.order.details.get', params)
      data = r?.data
      data = { list: list(data?.results, 'publisher_order_dto'), has_next: data?.has_next, position_index: data?.position_index }
    } catch (e) {
      if (!(e instanceof TopError && e.code === '11')) throw e
      officialDeniedAt = Date.now()
    }
  }
  if (!data) {
    const { readConfig } = await import('../../integrations')
    const { TB_ECAPI_KIND, tbEcapiConfigured } = await import('./ecapi')
    const t = await readConfig(TB_ECAPI_KIND)
    if (!tbEcapiConfigured(t))
      throw new BadRequestException('淘宝联盟应用未开通订单查询权限（taobao.tbk.order.details.get）；可在「淘宝联盟 · 喵有券」填写 apkey 与授权淘宝用户名，改用喵有券查询订单')
    const d = await ecapiCall('taoke/tbkOrderDetailsGet', { apkey: t.apiKey.trim(), tbname: t.tbname.trim(), ...params })
    data = { list: Array.isArray(d?.list) ? d.list : [], has_next: d?.has_next, position_index: d?.position_index }
  }
  const hasMore = data.has_next === true || data.has_next === 'true'
  if (hasMore && data.position_index) positions.set(key, String(data.position_index))
  else positions.delete(key)
  return { rows: data.list.map(normalizeTaobaoOrder), hasMore }
}
