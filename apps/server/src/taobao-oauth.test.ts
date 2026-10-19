import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  authStatus,
  callbackUrl,
  handleCallback,
  markInvalid,
  normalizePublicUrl,
  startAuthorize,
  usableSession,
  type OAuthStore,
  type TaobaoToken,
} from './platforms/taobao/oauth'

process.env.CONFIG_ENCRYPTION_KEY ||= 'a'.repeat(64)
const official = { appKey: '35454006', appSecret: 'secret-x', publicUrl: 'https://shihui.example.com' }
function memoryStore() {
  const states = new Map<string, any>()
  let token: TaobaoToken | null = null
  const store: OAuthStore & { states: typeof states; token: () => TaobaoToken | null } = {
    states,
    token: () => token,
    async putState(h, r) {
      states.set(h, r)
    },
    async takeState(h) {
      const r = states.get(h) ?? null
      states.delete(h)
      return r
    },
    async purgeStates(now) {
      for (const [k, v] of states) if (v.expiresAt < now) states.delete(k)
    },
    async readToken() {
      return token
    },
    async writeToken(t) {
      token = t
    },
    async deleteToken() {
      token = null
    },
  }
  return store
}
const tokenResult = (over: Record<string, unknown> = {}) => ({
  token_result: JSON.stringify({
    access_token: 'SESSION-SECRET',
    refresh_token: 'REFRESH-SECRET',
    expire_time: Date.now() + 86400000,
    refresh_token_valid_time: Date.now() + 2 * 86400000,
    user_id: '2200000001',
    user_nick: encodeURIComponent('影空幻灭者'),
    ...over,
  }),
})
const stateOf = (url: string) => new URL(url).searchParams.get('state')!
const admin = async () => true

test('外部访问地址只接受协议 + 主机，回调地址固定', () => {
  assert.equal(normalizePublicUrl('https://shihui.example.com/'), 'https://shihui.example.com')
  assert.throws(() => normalizePublicUrl('https://evil.com/path?x=1'))
  assert.throws(() => normalizePublicUrl('javascript:alert(1)'))
  assert.equal(callbackUrl(official), 'https://shihui.example.com/api/v1/callbacks/taobao/oauth')
})

test('发起授权：官方授权地址、state 随机且只保存哈希', async () => {
  const store = memoryStore()
  const { url } = await startAuthorize(store, official, 'admin-1')
  const u = new URL(url)
  assert.equal(u.origin + u.pathname, 'https://oauth.taobao.com/authorize')
  assert.equal(u.searchParams.get('response_type'), 'code')
  assert.equal(u.searchParams.get('client_id'), '35454006')
  assert.equal(u.searchParams.get('redirect_uri'), 'https://shihui.example.com/api/v1/callbacks/taobao/oauth')
  assert.ok(!url.includes('secret-x'))
  const state = stateOf(url)
  assert.ok(state.length >= 30)
  assert.ok(!store.states.has(state))
  assert.ok(store.states.has(createHash('sha256').update(state).digest('hex')))
  await assert.rejects(startAuthorize(store, { ...official, publicUrl: '' }, 'admin-1'), /外部访问地址/)
})

test('回调：成功换取凭证；同一 state 重复回调被拒绝', async () => {
  const store = memoryStore()
  const state = stateOf((await startAuthorize(store, official, 'admin-1')).url)
  const calls: string[] = []
  const exchange = async (_c: unknown, method: string, biz: Record<string, unknown>) => {
    calls.push(`${method}:${biz.code}`)
    return tokenResult()
  }
  const ok = await handleCallback(store, official, { code: 'CODE_123', state }, exchange, admin)
  assert.deepEqual(ok, { ok: true, nick: '影空幻灭者' })
  assert.deepEqual(calls, ['taobao.top.auth.token.create:CODE_123'])
  assert.equal(store.token()!.session, 'SESSION-SECRET')
  assert.equal(store.token()!.authorizedBy, 'admin-1')
  const again = await handleCallback(store, official, { code: 'CODE_123', state }, exchange, admin)
  assert.deepEqual(again, { ok: false, reason: 'invalid_state' })
  assert.equal(calls.length, 1)
  assert.deepEqual(await handleCallback(store, official, { code: 'X1234', state: 'forged-state-value-1234' }, exchange, admin), { ok: false, reason: 'invalid_state' })
})

test('回调：过期、AppKey 变更、管理员失效、用户拒绝、换取失败都不覆盖已有凭证', async () => {
  const store = memoryStore()
  const keep = { session: 'OLD', refreshToken: null, expiresAt: null, refreshExpiresAt: null, userId: '1', userNick: 'old', appKey: '35454006', authorizedAt: 1, authorizedBy: 'a' }
  await store.writeToken(keep)
  const exchange = async () => tokenResult()
  const t0 = Date.now()
  let s = stateOf((await startAuthorize(store, official, 'admin-1', t0)).url)
  assert.deepEqual(await handleCallback(store, official, { code: 'C1234', state: s }, exchange, admin, t0 + 11 * 60000), { ok: false, reason: 'expired_state' })
  s = stateOf((await startAuthorize(store, official, 'admin-1')).url)
  assert.deepEqual(await handleCallback(store, { ...official, appKey: 'other' }, { code: 'C1234', state: s }, exchange, admin), { ok: false, reason: 'config_changed' })
  s = stateOf((await startAuthorize(store, official, 'admin-1')).url)
  assert.deepEqual(await handleCallback(store, official, { code: 'C1234', state: s }, exchange, async () => false), { ok: false, reason: 'admin_invalid' })
  s = stateOf((await startAuthorize(store, official, 'admin-1')).url)
  assert.deepEqual(await handleCallback(store, official, { error: 'access_denied', state: s }, exchange, admin), { ok: false, reason: 'denied' })
  s = stateOf((await startAuthorize(store, official, 'admin-1')).url)
  const fail = async () => {
    throw new Error('isp.param-authorization.code.invalid')
  }
  assert.deepEqual(await handleCallback(store, official, { code: 'C1234', state: s }, fail, admin), { ok: false, reason: 'exchange_failed' })
  assert.deepEqual(store.token(), keep)
})

test('授权状态不含 session 与刷新凭证', async () => {
  const store = memoryStore()
  const s = stateOf((await startAuthorize(store, official, 'admin-1')).url)
  await handleCallback(store, official, { code: 'C1234', state: s }, async () => tokenResult(), admin)
  const st = await authStatus(store, official)
  const text = JSON.stringify(st)
  assert.equal(st.state, 'ACTIVE')
  assert.ok(!text.includes('SESSION-SECRET') && !text.includes('REFRESH-SECRET') && !text.includes('secret-x'))
  assert.equal((await authStatus(store, { ...official, appKey: 'x' })).state, 'APP_CHANGED')
})

test('凭证加密存储：密文不含明文 session', async () => {
  const { encrypt, decrypt } = await import('./security')
  const enc = encrypt({ session: 'SESSION-SECRET' }, 'oauth:taobao')
  assert.ok(!enc.includes('SESSION-SECRET'))
  assert.deepEqual(decrypt(enc, 'oauth:taobao'), { session: 'SESSION-SECRET' })
  assert.throws(() => decrypt(enc, 'other-context'))
})

test('session：临近过期按官方接口刷新并保存新 refresh_token；不能刷新且已过期提示重新授权；失效标记', async () => {
  const store = memoryStore()
  const now = Date.now()
  await store.writeToken({ session: 'S1', refreshToken: 'R1', expiresAt: now + 60000, refreshExpiresAt: now + 86400000, userId: '1', userNick: 'n', appKey: '35454006', authorizedAt: now, authorizedBy: 'a' })
  const seen: string[] = []
  const s = await usableSession(store, official, async (_c, method, biz) => {
    seen.push(`${method}:${biz.refresh_token}`)
    return tokenResult({ access_token: 'S2', refresh_token: 'R2' })
  }, now)
  assert.equal(s, 'S2')
  assert.deepEqual(seen, ['taobao.top.auth.token.refresh:R1'])
  assert.equal(store.token()!.refreshToken, 'R2')
  await store.writeToken({ ...store.token()!, expiresAt: now - 1000, refreshToken: null })
  await assert.rejects(usableSession(store, official, async () => tokenResult(), now), /重新授权/)
  await store.writeToken({ ...store.token()!, expiresAt: now + 86400000 })
  assert.equal(await usableSession(store, official, async () => tokenResult(), now), 'S2')
  await markInvalid(store, '淘宝账号授权已失效', now)
  await assert.rejects(usableSession(store, official, async () => tokenResult(), now), /已失效/)
  await assert.rejects(usableSession(memoryStore(), official, async () => tokenResult()), /尚未授权/)
})
