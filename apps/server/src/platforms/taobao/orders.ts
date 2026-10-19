// 淘宝联盟推广订单。三种数据源由后台「订单数据源」明确选择，不做隐式切换：
//   official-sc  官方账号授权：taobao.tbk.sc.order.details.get（需授权 session，https://developer.alibaba.com/docs/api.htm?apiId=43755）
//   official     官方推广者：taobao.tbk.order.details.get（应用自身推广者账号）
//   ecapi        喵有券：taoke/tbkOrderDetailsGet（字段与官方一致）
// 三者返回同一套订单字段，统一按 trade_parent_id / trade_id 入库；唯一性与数据源无关，切换数据源不会重复入库。
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

/** 金额口径（见官方字段说明）：付款金额 alipay_total_price 不含运费；佣金结算后取结算预估收入 pub_share_fee，失效为 0，其余取付款预估收入 pub_share_pre_fee */
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
    // 计佣金额：total_commission_fee 未结算时按付款金额、结算后按结算金额（pay_price）计算
    commissionBase: status === '3' ? (cents(raw.pay_price) ?? paid) : paid,
  }
}
/** 淘宝佣金结算：tk_status 3 已结算（tk_earning_time 为结算时间），13 已失效，其余未结算 */
export function taobaoOrderSettlement(value: unknown) {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const status = String(raw.tk_status ?? '')
  if (status === '13') return { state: 'INVALID' as const, settledAt: null }
  if (status === '3') {
    const at = taobaoDate(raw.tk_earning_time)
    return { state: 'SETTLED' as const, settledAt: at ? dateText(at) : null }
  }
  return { state: 'PENDING' as const, settledAt: null }
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
    // 接口没有确认收货时间字段（tk_earning_time 是佣金结算时间，见 orderSettlement），完成时间记为未获取，不与结算时间混用
    completedAt: null,
    commissionCents: amounts.commission,
    commissionBaseCents: base,
    sku: raw.item_id != null ? String(raw.item_id) : '',
    title: String(raw.item_title || '商品信息待确认'),
    quantity: Number.isSafeInteger(num) && num > 0 ? num : 1,
  }
}

export type TaobaoOrderSource = 'official-sc' | 'official' | 'ecapi'
export const ORDER_SOURCES: Record<TaobaoOrderSource, string> = {
  'official-sc': '官方账号授权（taobao.tbk.sc.order.details.get）',
  official: '官方推广者（taobao.tbk.order.details.get）',
  ecapi: '喵有券（tbkOrderDetailsGet）',
}
/**
 * 订单数据源：以保存的「订单数据源」为准；旧配置没有该字段时，按旧版实际可用的数据源推断一次（配置了喵有券授权账号则为喵有券，否则为官方推广者），
 * 之后不再在运行中隐式切换。
 */
export function orderSourceOf(c: PlatformConfig, ecapiConfigured: boolean): TaobaoOrderSource {
  if (c.orderSource && c.orderSource in ORDER_SOURCES) return c.orderSource as TaobaoOrderSource
  return ecapiConfigured ? 'ecapi' : 'official'
}

/** 订单查询失败的分类，供同步任务与后台展示 */
export class TaobaoOrderError extends BadRequestException {
  constructor(public kind: 'AUTH' | 'PERMISSION' | 'RATE_LIMIT' | 'TIMEOUT' | 'FORMAT' | 'PARAM' | 'UPSTREAM', message: string) {
    super(message)
  }
}
const retryable = (e: unknown) => e instanceof TaobaoOrderError && ['RATE_LIMIT', 'TIMEOUT', 'UPSTREAM'].includes(e.kind)
export function classifyTopError(e: unknown, method: string): TaobaoOrderError {
  if (e instanceof TaobaoOrderError) return e
  if (e instanceof TopError) {
    const sub = e.subCode
    if (['26', '27'].includes(e.code) || /session/i.test(sub)) return new TaobaoOrderError('AUTH', `淘宝账号授权已失效或缺失（${e.code}${sub ? '/' + sub : ''}），请重新授权`)
    if (e.code === '11') return new TaobaoOrderError('PERMISSION', `应用没有 ${method} 接口权限（错误码 11），请在淘宝开放平台申请对应权限包；账号授权不能代替接口权限`)
    if (e.code === '12') return new TaobaoOrderError('PERMISSION', `授权账号没有调用 ${method} 的权限（错误码 12）`)
    if (/-4002/.test(sub + e.message)) return new TaobaoOrderError('PERMISSION', '账号无法调用该接口（-4002）：需在淘宝联盟服务商平台将授权账号加入名单')
    if (e.code === '7' || /9100|limit|flow/i.test(sub + e.message)) return new TaobaoOrderError('RATE_LIMIT', `淘宝联盟接口限流（${e.code}${sub ? '/' + sub : ''}），稍后自动重试`)
    if (/3001|unavailable|isp\./i.test(sub + e.message) || e.code === '10' || e.code === '15') return new TaobaoOrderError('UPSTREAM', `淘宝联盟服务暂不可用（${e.code}${sub ? '/' + sub : ''}）`)
    return new TaobaoOrderError('PARAM', e.message)
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/超时|网络|timeout|ECONN|fetch failed/i.test(msg)) return new TaobaoOrderError('TIMEOUT', `订单查询网络失败或超时：${msg}`)
  if (/喵有券接口未成功（错误码 (429)）/.test(msg)) return new TaobaoOrderError('RATE_LIMIT', msg)
  if (/喵有券接口未成功（错误码 (401|1038)）/.test(msg)) return new TaobaoOrderError('PERMISSION', msg)
  if (/喵有券.*(超时|网络)/.test(msg)) return new TaobaoOrderError('TIMEOUT', msg)
  return new TaobaoOrderError('UPSTREAM', msg)
}

type Page = { list: any[]; hasNext: boolean; position: string | null }
/** 校验响应结构：缺少 data 或列表结构异常时报错，绝不当作零订单推进进度 */
export function readOrderPage(data: any, listOf: (d: any) => unknown): Page {
  if (!data || typeof data !== 'object') throw new TaobaoOrderError('FORMAT', '订单接口响应缺少 data，已停止以免遗漏订单')
  const raw = listOf(data)
  const list = raw == null ? [] : Array.isArray(raw) ? raw : typeof raw === 'object' ? [raw] : null
  if (!list) throw new TaobaoOrderError('FORMAT', '订单接口返回的订单列表格式异常')
  const hasNext = data.has_next === true || data.has_next === 'true'
  const position = data.position_index != null && data.position_index !== '' ? String(data.position_index) : null
  if (hasNext && !position) throw new TaobaoOrderError('FORMAT', '订单接口提示还有下一页，但未返回翻页位点')
  return { list, hasNext, position }
}

export type OrderDeps = {
  /** 取官方授权 session（仅 official-sc） */
  session?: () => Promise<string>
  /** 授权失效时回写状态 */
  onAuthInvalid?: (reason: string) => Promise<void>
  /** 喵有券配置 */
  ecapi?: () => Promise<{ apiKey: string; tbname: string } | null>
  sleep?: (ms: number) => Promise<void>
}
const RETRY_DELAYS = [1000, 3000]

/** 查询一页订单：page>1 时必须带上一页的 position_index（由同步任务持久化在游标里） */
export async function queryTaobaoOrders(
  c: PlatformConfig,
  request: { from: Date; until: Date; page: number; type: 1 | 3; position?: string | null },
  deps: OrderDeps = {},
): Promise<{ rows: PlatformOrder[]; hasMore: boolean; position: string | null }> {
  const source = (c.orderSource as TaobaoOrderSource) || 'official'
  if (request.page > 1 && !request.position) throw new TaobaoOrderError('PARAM', '翻页位点丢失，已停止；请重新同步该时间段')
  const params = {
    query_type: String(request.type === 3 ? 4 : 1), // 1 按创建时间（历史回补）；4 按更新时间（增量）
    // 向前重叠 1 分钟，避免时间段边界漏单；重复数据由订单行唯一键幂等更新
    start_time: dateText(new Date(request.from.getTime() - 60000)),
    end_time: dateText(request.until),
    page_no: String(request.page),
    page_size: '100',
    order_scene: '1',
    jump_type: '1',
    position_index: request.page > 1 ? request.position || undefined : undefined,
  }
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const once = async (): Promise<Page> => {
    if (source === 'ecapi') {
      const t = await deps.ecapi?.()
      if (!t) throw new TaobaoOrderError('PERMISSION', '订单数据源为喵有券，但未填写「淘宝联盟 · 喵有券」的 apkey 与授权淘宝用户名')
      const d = await ecapiCall('taoke/tbkOrderDetailsGet', { apkey: t.apiKey, tbname: t.tbname, ...params })
      return readOrderPage(d, (x) => x.list)
    }
    const method = source === 'official-sc' ? 'taobao.tbk.sc.order.details.get' : 'taobao.tbk.order.details.get'
    const session = source === 'official-sc' ? await (deps.session ?? (() => Promise.reject(new TaobaoOrderError('AUTH', '尚未授权淘宝账号'))))() : undefined
    const r = await topRequest(c, method, params, session ? { session } : {})
    return readOrderPage(r?.data, (x) => (x.results == null ? null : list(x.results, 'publisher_order_dto')))
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const page = await once()
      return { rows: page.list.map(normalizeTaobaoOrder), hasMore: page.hasNext, position: page.hasNext ? page.position : null }
    } catch (e) {
      const err = classifyTopError(e, source === 'official-sc' ? 'taobao.tbk.sc.order.details.get' : 'taobao.tbk.order.details.get')
      if (err.kind === 'AUTH' && source === 'official-sc') await deps.onAuthInvalid?.(err.message).catch(() => undefined)
      if (!retryable(err) || attempt >= RETRY_DELAYS.length) throw err
      await sleep(RETRY_DELAYS[attempt])
    }
  }
}
