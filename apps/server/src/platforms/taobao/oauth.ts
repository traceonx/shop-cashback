// 淘宝开放平台用户授权（OAuth 2.0 server 端流程），用于 taobao.tbk.sc.order.details.get 等需要 session 的接口。
// 依据：淘宝开放平台「用户授权介绍」https://developer.alibaba.com/docs/doc.htm?treeId=49&articleId=102635&docType=1
//   授权地址 https://oauth.taobao.com/authorize?response_type=code&client_id=AppKey&redirect_uri=回调&state=&view=web
//   redirect_uri 须与应用「回调地址」同域（控制台 → 应用管理 → 应用设置 → 基础信息 → 回调地址）
//   code 30 分钟内有效且只能使用一次；用 taobao.top.auth.token.create 换取 access_token（即 session）
//   只有服务市场订购类应用可用 taobao.top.auth.token.refresh 刷新；其他类型应用到期需重新授权
// 授权与接口权限是两回事：授权只代表该淘宝账号同意本应用访问其数据，应用仍须具备对应 API 权限包。
import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import type { PlatformConfig } from '../types'

export const OAUTH_AUTHORIZE_URL = 'https://oauth.taobao.com/authorize'
export const OAUTH_CALLBACK_PATH = '/api/v1/callbacks/taobao/oauth'
export const STATE_TTL_MS = 10 * 60 * 1000
const STATE_PREFIX = 'oauth-state:taobao:'
const TOKEN_KEY = 'oauth:taobao'

/** 服务端保存的授权凭证（整体加密存储，任何接口都不返回 session / refreshToken 明文） */
export type TaobaoToken = {
  session: string
  refreshToken: string | null
  expiresAt: number | null
  refreshExpiresAt: number | null
  userId: string | null
  userNick: string | null
  appKey: string
  authorizedAt: number
  authorizedBy: string
  /** 调用接口时检测到授权失效的时间；不删除凭证，等待重新授权覆盖 */
  invalidAt?: number | null
  invalidReason?: string | null
}
type StateRecord = { actorId: string; appKey: string; expiresAt: number }

/** 持久化抽象：生产环境为加密的 systemConfig，测试可注入内存实现 */
export interface OAuthStore {
  putState(hash: string, record: StateRecord): Promise<void>
  /** 原子地取出并删除；不存在返回 null（保证一次性） */
  takeState(hash: string): Promise<StateRecord | null>
  purgeStates(now: number): Promise<void>
  readToken(): Promise<TaobaoToken | null>
  writeToken(token: TaobaoToken): Promise<void>
  deleteToken(): Promise<void>
}
export type TokenExchange = (official: PlatformConfig, method: string, biz: Record<string, unknown>) => Promise<any>

const hashState = (state: string) => createHash('sha256').update(state).digest('hex')

/** 外部访问地址：只接受 http(s)://主机[:端口]，不带路径与参数，避免拼出任意跳转地址 */
export function normalizePublicUrl(raw: string | undefined): string | null {
  const text = (raw || '').trim().replace(/\/+$/, '')
  if (!text) return null
  let u: URL
  try {
    u = new URL(text)
  } catch {
    throw new BadRequestException('外部访问地址格式无效，应为 https://域名[:端口]')
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || (u.pathname && u.pathname !== '/') || u.search || u.hash)
    throw new BadRequestException('外部访问地址只填协议、域名和端口，例如 https://shihui.example.com')
  return `${u.protocol}//${u.host}`
}
export const callbackUrl = (official: PlatformConfig) => {
  const base = normalizePublicUrl(official.publicUrl || process.env.PUBLIC_BASE_URL)
  return base ? base + OAUTH_CALLBACK_PATH : null
}

/** 发起授权：生成随机一次性 state（只存哈希），绑定发起的管理员与当前 AppKey */
export async function startAuthorize(store: OAuthStore, official: PlatformConfig, actorId: string, now = Date.now()) {
  if (!official.appKey || !official.appSecret) throw new BadRequestException('请先保存淘宝联盟 AppKey 和 AppSecret')
  const redirect = callbackUrl(official)
  if (!redirect) throw new BadRequestException('请先填写「外部访问地址」（淘宝回调本系统的公网地址），并在淘宝开放平台把回调地址设为同一域名')
  await store.purgeStates(now)
  const state = randomBytes(24).toString('base64url')
  await store.putState(hashState(state), { actorId, appKey: official.appKey, expiresAt: now + STATE_TTL_MS })
  const q = new URLSearchParams({ response_type: 'code', client_id: official.appKey, redirect_uri: redirect, state, view: 'web' })
  return { url: `${OAUTH_AUTHORIZE_URL}?${q}`, expiresAt: now + STATE_TTL_MS }
}

const nickOf = (v: unknown) => {
  if (v == null || v === '') return null
  try {
    return decodeURIComponent(String(v)).slice(0, 64)
  } catch {
    return String(v).slice(0, 64)
  }
}
/** 解析 taobao.top.auth.token.create / refresh 返回的 token_result（JSON 字符串） */
export function parseTokenResult(resp: any) {
  const raw = resp?.token_result
  let t: any
  try {
    t = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    t = null
  }
  if (!t || typeof t.access_token !== 'string' || !t.access_token) throw new BadRequestException('淘宝授权接口未返回有效凭证')
  const ms = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return {
    session: t.access_token as string,
    refreshToken: typeof t.refresh_token === 'string' && t.refresh_token ? (t.refresh_token as string) : null,
    expiresAt: ms(t.expire_time),
    refreshExpiresAt: ms(t.refresh_token_valid_time),
    userId: t.user_id != null ? String(t.user_id) : t.taobao_user_id != null ? String(t.taobao_user_id) : null,
    userNick: nickOf(t.user_nick ?? t.taobao_user_nick),
  }
}

export type CallbackResult = { ok: true; nick: string | null } | { ok: false; reason: string }
/**
 * 处理淘宝回调：state 必须存在、未过期、未使用，且 AppKey 未变更；成功后才写入凭证，失败不触碰已有凭证。
 * 返回值只含可展示的结果，不含凭证。
 */
export async function handleCallback(
  store: OAuthStore,
  official: PlatformConfig,
  query: { code?: string; state?: string; error?: string; error_description?: string },
  exchange: TokenExchange,
  isActiveAdmin: (actorId: string) => Promise<boolean>,
  now = Date.now(),
): Promise<CallbackResult> {
  const state = typeof query.state === 'string' ? query.state : ''
  if (!/^[\w-]{16,128}$/.test(state)) return { ok: false, reason: 'invalid_state' }
  const record = await store.takeState(hashState(state))
  if (!record) return { ok: false, reason: 'invalid_state' }
  if (record.expiresAt < now) return { ok: false, reason: 'expired_state' }
  if (query.error) return { ok: false, reason: 'denied' }
  if (record.appKey !== official.appKey) return { ok: false, reason: 'config_changed' }
  if (!(await isActiveAdmin(record.actorId))) return { ok: false, reason: 'admin_invalid' }
  const code = typeof query.code === 'string' ? query.code : ''
  if (!/^[\w-]{4,256}$/.test(code)) return { ok: false, reason: 'missing_code' }
  let token
  try {
    token = parseTokenResult(await exchange(official, 'taobao.top.auth.token.create', { code }))
  } catch (e) {
    console.warn(`[淘宝授权] 换取凭证失败：${e instanceof Error ? e.message.slice(0, 200) : '未知错误'}`)
    return { ok: false, reason: 'exchange_failed' }
  }
  await store.writeToken({ ...token, appKey: official.appKey, authorizedAt: now, authorizedBy: record.actorId, invalidAt: null, invalidReason: null })
  console.log(`[淘宝授权] 账号「${token.userNick || token.userId || '未知'}」授权成功`)
  return { ok: true, nick: token.userNick }
}

/** 授权状态（可安全返回前端：不含 session / refreshToken） */
export async function authStatus(store: OAuthStore, official: PlatformConfig, now = Date.now()) {
  const t = await store.readToken()
  const base = { callbackUrl: callbackUrl(official), publicUrl: normalizePublicUrlSafe(official.publicUrl) }
  if (!t) return { ...base, authorized: false as const, state: 'NONE' as const }
  const expired = t.expiresAt != null && t.expiresAt <= now
  const canRefresh = !!t.refreshToken && (t.refreshExpiresAt == null || t.refreshExpiresAt > now)
  const stateText = t.appKey !== official.appKey ? 'APP_CHANGED' : t.invalidAt ? 'INVALID' : expired ? (canRefresh ? 'EXPIRED_REFRESHABLE' : 'EXPIRED') : 'ACTIVE'
  return {
    ...base,
    authorized: true as const,
    state: stateText as 'APP_CHANGED' | 'INVALID' | 'EXPIRED_REFRESHABLE' | 'EXPIRED' | 'ACTIVE',
    userNick: t.userNick,
    userId: t.userId,
    expiresAt: t.expiresAt,
    refreshExpiresAt: t.refreshExpiresAt,
    canRefresh,
    authorizedAt: t.authorizedAt,
    invalidReason: t.invalidReason ?? null,
  }
}
function normalizePublicUrlSafe(raw?: string) {
  try {
    return normalizePublicUrl(raw)
  } catch {
    return null
  }
}

export class TaobaoAuthError extends BadRequestException {}
const REFRESH_AHEAD_MS = 30 * 60 * 1000
/**
 * 取可用 session：AppKey 必须与授权时一致；临近过期且有可用 refresh_token 时尝试刷新（仅订购类应用支持），
 * 刷新失败或不支持时保留原凭证并提示重新授权。
 */
export async function usableSession(store: OAuthStore, official: PlatformConfig, exchange: TokenExchange, now = Date.now()) {
  const t = await store.readToken()
  if (!t) throw new TaobaoAuthError('尚未授权淘宝账号，请在「渠道配置 → 淘宝联盟」点击「授权淘宝账号」')
  if (t.appKey !== official.appKey) throw new TaobaoAuthError('AppKey 已变更，原授权不再适用，请重新授权淘宝账号')
  if (t.invalidAt) throw new TaobaoAuthError(`淘宝账号授权已失效${t.invalidReason ? `（${t.invalidReason}）` : ''}，请重新授权`)
  const soon = t.expiresAt != null && t.expiresAt - now < REFRESH_AHEAD_MS
  if (!soon) return t.session
  const canRefresh = !!t.refreshToken && (t.refreshExpiresAt == null || t.refreshExpiresAt > now)
  if (canRefresh) {
    try {
      const fresh = parseTokenResult(await exchange(official, 'taobao.top.auth.token.refresh', { refresh_token: t.refreshToken }))
      // 每次刷新旧 refresh_token 即失效，必须保存最新的
      await store.writeToken({ ...t, ...fresh, refreshToken: fresh.refreshToken ?? t.refreshToken, invalidAt: null, invalidReason: null })
      return fresh.session
    } catch (e) {
      console.warn(`[淘宝授权] 刷新凭证失败（只有服务市场订购类应用支持刷新）：${e instanceof Error ? e.message.slice(0, 200) : '未知错误'}`)
    }
  }
  if (t.expiresAt != null && t.expiresAt <= now) throw new TaobaoAuthError('淘宝账号授权已过期，当前应用无法自动续期，请重新授权')
  return t.session
}
/** 接口返回授权失效时标记（不删除凭证，也不影响其他配置） */
export async function markInvalid(store: OAuthStore, reason: string, now = Date.now()) {
  const t = await store.readToken()
  if (t && !t.invalidAt) await store.writeToken({ ...t, invalidAt: now, invalidReason: reason.slice(0, 80) })
}

/** 生产环境存储：state 与凭证放在 systemConfig；凭证用 CONFIG_ENCRYPTION_KEY 加密 */
export function dbOAuthStore(): OAuthStore {
  // 延迟加载，避免单元测试引入数据库
  const load = () => Promise.all([import('../../database'), import('../../security')])
  return {
    async putState(hash, record) {
      const [{ db }] = await load()
      await db.systemConfig.create({ data: { key: STATE_PREFIX + hash, value: record } })
    },
    async takeState(hash) {
      const [{ db }] = await load()
      return db.$transaction(async (tx) => {
        const row = await tx.systemConfig.findUnique({ where: { key: STATE_PREFIX + hash } })
        if (!row) return null
        const del = await tx.systemConfig.deleteMany({ where: { key: STATE_PREFIX + hash } })
        return del.count === 1 ? (row.value as unknown as StateRecord) : null
      })
    },
    async purgeStates(now) {
      const [{ db }] = await load()
      const rows = await db.systemConfig.findMany({ where: { key: { startsWith: STATE_PREFIX } }, select: { key: true, value: true } })
      const stale = rows.filter((r) => Number((r.value as any)?.expiresAt) < now).map((r) => r.key)
      if (stale.length) await db.systemConfig.deleteMany({ where: { key: { in: stale } } })
    },
    async readToken() {
      const [{ db }, { decrypt }] = await load()
      const row = await db.systemConfig.findUnique({ where: { key: TOKEN_KEY } })
      const enc = (row?.value as { encrypted?: string } | null)?.encrypted
      return enc ? decrypt<TaobaoToken>(enc, TOKEN_KEY) : null
    },
    async writeToken(token) {
      const [{ db }, { encrypt }] = await load()
      const value = { encrypted: encrypt(token, TOKEN_KEY) }
      await db.systemConfig.upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value }, update: { value } })
    },
    async deleteToken() {
      const [{ db }] = await load()
      await db.systemConfig.deleteMany({ where: { key: TOKEN_KEY } })
    },
  }
}
