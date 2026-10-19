import { useCallback, useEffect, useState } from 'react'
import { Copy, Globe, KeyRound, Link2, RefreshCw, ShieldCheck, Unlink } from 'lucide-react'
import { api } from '../lib/api'
import { dateTime, errorText } from '../lib/format'
import { Alert, Button, Chip, Select, SplitButton, Switch, TextField, confirm } from '../ui'
import type { useIntegration } from './integration'

type Source = 'official-sc' | 'official' | 'ecapi'
const sources: [Source, string][] = [
  ['official-sc', '官方账号授权（taobao.tbk.sc.order.details.get）'],
  ['official', '官方推广者（taobao.tbk.order.details.get）'],
  ['ecapi', '喵有券（tbkOrderDetailsGet）'],
]
type OAuth = {
  authorized: boolean
  state: 'NONE' | 'ACTIVE' | 'EXPIRED' | 'EXPIRED_REFRESHABLE' | 'INVALID' | 'APP_CHANGED'
  callbackUrl: string | null
  publicUrl: string | null
  userNick?: string | null
  expiresAt?: number | null
  refreshExpiresAt?: number | null
  canRefresh?: boolean
  authorizedAt?: number
  invalidReason?: string | null
}
type Sync = { status: string; count: number; windows: number; total: number; error?: string | null; lastSyncedAt?: string | null; auto?: boolean } | null
const stateText: Record<OAuth['state'], [string, 'success' | 'warning' | 'error' | 'secondary']> = {
  NONE: ['未授权', 'secondary'],
  ACTIVE: ['授权有效', 'success'],
  EXPIRED_REFRESHABLE: ['已过期，将自动续期', 'warning'],
  EXPIRED: ['已过期，需重新授权', 'error'],
  INVALID: ['授权已失效，需重新授权', 'error'],
  APP_CHANGED: ['AppKey 已变更，需重新授权', 'error'],
}
const ranges: [string, string][] = [
  ['24', '最近 24 小时'],
  ['168', '最近 7 天'],
  ['720', '最近 30 天'],
  ['2160', '最近 90 天'],
]
const ms = (v?: number | null) => (v ? dateTime(new Date(v).toISOString()) : '未返回')

/** 淘宝联盟：订单数据源、官方账号授权、订单测试与历史同步 */
export function TaobaoOrderPanel({ it }: { it: ReturnType<typeof useIntegration> }) {
  const effective = ((it.data as unknown as { orderSource?: Source })?.orderSource || 'official') as Source
  const source = ((it.values.orderSource as Source) || effective) as Source
  const [oauth, setOAuth] = useState<OAuth>()
  const [sync, setSync] = useState<Sync>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const savedSource = it.data?.fields.find((f) => f.key === 'orderSource')?.value || effective

  const loadOAuth = useCallback(async () => {
    try {
      setOAuth(await api<OAuth>('/integrations/taobao/oauth'))
    } catch (e) {
      setError(errorText(e))
    }
  }, [])
  // 保存配置（如外部访问地址）后重新读取，回调地址随之更新
  useEffect(() => {
    void loadOAuth()
  }, [loadOAuth, it.data])
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const s = await api<Sync>('/orders/sync-status?platform=taobao')
        if (alive) setSync(s)
      } catch {
        /* 轮询失败不打断 */
      }
    }
    void poll()
    const t = setInterval(poll, 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const run = async (key: string, task: () => Promise<string | void>) => {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      const msg = await task()
      if (msg) setNotice(msg)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }
  const authorize = () =>
    run('auth', async () => {
      const r = await api<{ url: string }>('/integrations/taobao/oauth/start', { method: 'POST' })
      // 跳转到淘宝官方授权页，完成后淘宝回调本系统并跳回本页
      window.location.href = r.url
    })
  const unbind = async () => {
    const ok = await confirm({
      title: '解除本系统绑定',
      content: '只删除本系统保存的淘宝授权凭证，之后无法用该账号查询订单；不会撤销淘宝侧的授权记录（如需撤销，请在淘宝账号的授权管理中操作）。已同步的订单不受影响。',
      okText: '解除绑定',
      danger: true,
    })
    if (ok)
      await run('unbind', async () => {
        await api('/integrations/taobao/oauth', { method: 'DELETE' })
        await loadOAuth()
        return '已解除本系统绑定'
      })
  }
  const test = () =>
    run('test', async () => {
      const r = await api<{ count: number; hasMore: boolean }>('/integrations/taobao/orders/test', { method: 'POST' })
      await loadOAuth()
      return `订单查询成功：最近 20 分钟有更新的订单 ${r.count} 条${r.hasMore ? '（还有更多）' : ''}`
    })
  const syncHistory = (hours = '24') =>
    run('sync', async () => {
      const r = await api<{ message: string }>('/orders/sync', { method: 'POST', body: JSON.stringify({ platform: 'taobao', hours: Number(hours) }) })
      return r.message
    })

  const st = oauth ? stateText[oauth.state] : null
  const running = sync && ['QUEUED', 'RUNNING'].includes(sync.status)
  return (
    <div className="stack">
      <Select<Source>
        label="订单数据源"
        hint="与转链数据源分开配置；切换数据源不会重复入库（按订单号与子订单号去重）"
        value={source}
        options={sources}
        onChange={(v) => it.set('orderSource', v)}
      />
      <Switch
        label="按商品自动关联下单用户"
        checked={it.values.autoMatch !== 'false'}
        onChange={(v) => it.set('autoMatch', v ? 'true' : 'false')}
      />
      <small className="text-faint">
        淘宝订单没有联盟回传的用户标识：下单前 7 天内（含下单后 10 分钟）只有一个用户转过同一商品，且商品 ID 或完整标题一致时自动关联，订单标注「按商品匹配」，通知提醒用户核对；多人可能转过同一商品时不关联，需人工关联。分享出去的链接被他人下单无法识别。
      </small>
      {source === 'official-sc' && (
        <>
          <div className="grid-2">
            <TextField
              label="外部访问地址"
              icon={Globe}
              hint="淘宝跳回本系统用的公网地址（协议 + 域名 + 端口），需与淘宝开放平台应用「回调地址」同域"
              placeholder="https://shihui.example.com"
              value={it.values.publicUrl ?? ''}
              onChange={(e) => it.set('publicUrl', e.target.value)}
            />
            <TextField
              label="授权回调地址"
              icon={Link2}
              hint={oauth?.callbackUrl ? '复制后填到淘宝开放平台应用设置的回调地址' : '保存外部访问地址后生成'}
              readOnly
              value={oauth?.callbackUrl || ''}
              trailing={
                oauth?.callbackUrl ? (
                  <button type="button" className="btn btn-text" aria-label="复制回调地址" onClick={() => navigator.clipboard?.writeText(oauth.callbackUrl!)}>
                    <Copy size={15} />
                  </button>
                ) : undefined
              }
            />
          </div>
          <div className="oauth-box">
            <div className="oauth-head">
              <strong>授权淘宝账号</strong>
              {st && (
                <Chip tone={st[1]} dot>
                  {st[0]}
                </Chip>
              )}
            </div>
            {oauth?.authorized ? (
              <dl className="oauth-meta">
                <div>
                  <dt>已授权账号</dt>
                  <dd>{oauth.userNick || '未返回昵称'}</dd>
                </div>
                <div>
                  <dt>授权时间</dt>
                  <dd>{ms(oauth.authorizedAt)}</dd>
                </div>
                <div>
                  <dt>到期时间</dt>
                  <dd>{ms(oauth.expiresAt)}</dd>
                </div>
                <div>
                  <dt>自动续期</dt>
                  <dd>{oauth.canRefresh ? `支持（刷新凭证到期 ${ms(oauth.refreshExpiresAt)}）` : '不支持，到期需重新授权'}</dd>
                </div>
              </dl>
            ) : (
              <small className="text-faint">授权后用该淘宝账号的 session 查询其联盟推广订单（不是个人购物订单）。授权不能代替接口权限，应用需已开通 taobao.tbk.sc.order.details.get。</small>
            )}
            {oauth?.invalidReason && <Alert tone="warning">{oauth.invalidReason}</Alert>}
            <div className="oauth-actions">
              <Button variant="primary" icon={ShieldCheck} loading={busy === 'auth'} disabled={!!busy || it.dirty} onClick={authorize}>
                {oauth?.authorized ? '重新授权' : '授权淘宝账号'}
              </Button>
              {oauth?.authorized && (
                <Button variant="text" icon={Unlink} disabled={!!busy} onClick={unbind}>
                  解除本系统绑定
                </Button>
              )}
            </div>
            {it.dirty && <small className="text-faint">有未保存的修改，请先保存再授权</small>}
          </div>
        </>
      )}
      <div className="oauth-actions">
        <Button variant="outlined" icon={KeyRound} loading={busy === 'test'} disabled={!!busy || it.dirty || savedSource !== source} onClick={test}>
          测试订单查询
        </Button>
        <SplitButton icon={RefreshCw} loading={busy === 'sync' || !!running} onClick={() => void syncHistory()} options={ranges} onSelect={(h) => void syncHistory(h)} menuLabel="选择同步范围">
          同步历史订单
        </SplitButton>
      </div>
      {sync && (
        <small className="text-faint">
          {running
            ? `同步中：已处理 ${sync.windows}/${sync.total} 个时段，${sync.count} 条订单`
            : sync.status === 'FAILED'
              ? `上次同步失败：${sync.error || '未知原因'}`
              : `上次同步完成：${sync.count} 条订单`}
          {sync.lastSyncedAt ? ` · 最近成功 ${dateTime(sync.lastSyncedAt)}` : ''}
        </small>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
    </div>
  )
}
