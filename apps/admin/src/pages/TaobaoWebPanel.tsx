import { useEffect, useState } from 'react'
import { Alert, Button, Select, TextField, confirm } from '../ui'
import { api } from '../lib/api'
import { dateTime, errorText } from '../lib/format'
import type { useIntegration } from './integration'

type Status = { state: string; lastValid: number | null; expiredAt: number | null; account: string | null; notification: string | null }
const states: Record<string, string> = { NONE: '尚未连接', PENDING: '待验证', ACTIVE: '登录有效', EXPIRED: '登录已失效', VERIFY: '需要人工验证', LIMITED: '请求限流', NETWORK: '网络异常' }
export function TaobaoWebPanel({ it }: { it: ReturnType<typeof useIntegration> }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = () => api<Status>('/integrations/taobao/web').then(setStatus)
  useEffect(() => { void load().catch(e => setError(errorText(e))) }, [])
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await fn(); await load() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="oauth-box stack">
    <strong>淘宝联盟网页登录备用通道</strong>
    <Select label="使用方式" value={it.values.webMode || 'off'} options={[
      ['off', '关闭'], ['auto', '主通道不可用时自动备用'], ['manual', '手动切换到网页通道'],
    ]} onChange={v => it.set('webMode', v)} />
    <small className="text-faint">网页登录与开放平台 OAuth 独立。电脑运行登录助手，扫码登录后连接服务端，Docker 无需安装浏览器。自动模式仅在网络、限流或权限故障时备用，不对无商品、匹配歧义等错误重试。</small>
    <div className="grid-2">
      <TextField label="每分钟请求上限（1～20）" value={it.values.webRpm || '20'} onChange={e => it.set('webRpm', e.target.value)} />
      <TextField label="后台检查间隔（分钟，至少 5）" value={it.values.webHealthMinutes || '15'} onChange={e => it.set('webHealthMinutes', e.target.value)} />
      <TextField label="订单回溯天数（1～90）" value={it.values.webLookbackDays || '90'} onChange={e => it.set('webLookbackDays', e.target.value)} />
      <TextField label="后台访问地址" placeholder="https://shihui.example.com" value={it.values.publicUrl || ''} onChange={e => it.set('publicUrl', e.target.value)} hint="用于管理员失效提醒中的重新登录入口" />
    </div>
    <small>状态：{states[status?.state || 'NONE']} · 最近验证：{status?.lastValid ? dateTime(new Date(status.lastValid).toISOString()) : '尚未验证'}
      {status?.expiredAt ? ` · 检测失效：${dateTime(new Date(status.expiredAt).toISOString())}` : ''}
    </small>
    <small className="text-faint">失效时通知「渠道配置 → 企业微信」中的管理员 UserID，同一失效事件不重复提醒；网络异常不判为登录失效。网页订单按配置天数重新扫描，查询量大时同步会变慢。</small>
    {status?.notification === 'FAILED' && <Alert tone="warning">失效通知发送失败，请检查企业微信管理员配置。</Alert>}
    <div className="oauth-actions">
      <Button disabled={busy || it.dirty} onClick={() => void action(async () => {
        const r = await api<{ token: string }>('/integrations/taobao/web/login', { method: 'POST' }); setToken(r.token)
      })}>获取登录配对码</Button>
      <Button disabled={busy || it.dirty} onClick={() => void action(async () => { await api('/integrations/taobao/web/verify', { method: 'POST' }); setToken('') })}>验证登录</Button>
      <Button disabled={busy} onClick={() => void action(load)}>刷新状态</Button>
      <Button variant="text" disabled={busy} onClick={() => void action(async () => {
        if (await confirm({ title: '断开网页登录', content: '删除服务端保存的网页会话，原有官方接口与喵有券配置保留。' })) {
          await api('/integrations/taobao/web', { method: 'DELETE' }); setToken('')
        }
      })}>断开连接</Button>
    </div>
    {token && <><TextField label="一次性配对码（10 分钟有效）" readOnly value={token} onFocus={e => e.target.select()} />
      <small>在电脑端 tools/taobao-web-login 目录执行 npm install，再执行 npm start，按提示输入后台地址与配对码。完成扫码后刷新状态。使用方法见 docs/taobao-web-backup.md。</small></>}
    {it.dirty && <small>请先保存配置，再连接或验证。</small>}
    {error && <Alert tone="error">{error}</Alert>}
  </div>
}
