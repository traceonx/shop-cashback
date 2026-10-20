import { useEffect, useState } from 'react'
import { Alert, Button, Modal, Select, TextField, confirm } from '../ui'
import { api } from '../lib/api'
import { dateTime, errorText } from '../lib/format'
import type { useIntegration } from './integration'

type Status = { state: string; lastValid: number | null; expiredAt: number | null; account: string | null; notification: string | null; lastError: string | null }
type Login = { state: string; message: string; screenshot?: string | null; width: number; height: number }
const states: Record<string, string> = { NONE: '尚未连接', PENDING: '待验证', ACTIVE: '登录有效', EXPIRED: '登录已失效', VERIFY: '需要人工验证', LIMITED: '请求限流', NETWORK: '网络异常' }
export function TaobaoWebPanel({ it }: { it: ReturnType<typeof useIntegration> }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [login, setLogin] = useState<Login | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = () => api<Status>('/integrations/taobao/web').then(setStatus)
  useEffect(() => { void load().catch(e => setError(errorText(e))) }, [])
  const loginOpen = login !== null
  useEffect(() => {
    if (!loginOpen) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const r = await api<Login>('/integrations/taobao/web/login')
        if (!alive) return
        setLogin(r)
        if (r.state === 'CONNECTED') {
          setNotice('淘宝联盟登录成功，已连接。')
          setLogin(null)
          await load()
          return
        }
        if (r.state === 'ERROR' || r.state === 'CANCELLED') { await load(); return }
      } catch (e) { if (alive) setError(errorText(e)) }
      if (alive) timer = setTimeout(poll, 2000)
    }
    void poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [loginOpen])
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(''); setNotice('')
    try { await fn(); await load() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="oauth-box stack">
    <strong>淘宝联盟网页登录备用通道</strong>
    <Select label="使用方式" value={it.values.webMode || 'off'} options={[
      ['off', '关闭'], ['auto', '主通道不可用时自动备用'], ['manual', '手动切换到网页通道'],
    ]} onChange={v => it.set('webMode', v)} />
    <small className="text-faint">点击登录后，用手机淘宝扫描官方页面的二维码并确认，系统会自动连接。自动备用仅用于主通道的网络、限流或权限故障。</small>
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
    {status?.lastError && <Alert tone="warning">{status.lastError}</Alert>}
    <div className="oauth-actions">
      <Button disabled={busy || it.dirty} onClick={() => void action(async () => {
        setLogin(await api<Login>('/integrations/taobao/web/login', { method: 'POST' }))
      })}>{status?.lastValid ? '重新登录淘宝联盟' : '登录淘宝联盟'}</Button>
      <Button disabled={busy || it.dirty || !status?.lastValid} onClick={() => void action(async () => { await api('/integrations/taobao/web/verify', { method: 'POST' }) })}>验证登录</Button>
      <Button disabled={busy} onClick={() => void action(load)}>刷新状态</Button>
      <Button variant="text" disabled={busy} onClick={() => void action(async () => {
        if (await confirm({ title: '断开网页登录', content: '删除服务端保存的网页会话，原有官方接口与喵有券配置保留。' })) {
          await api('/integrations/taobao/web', { method: 'DELETE' }); setLogin(null)
        }
      })}>断开连接</Button>
    </div>
    {login && <Modal title="登录淘宝联盟" size="lg" onClose={() => void action(async () => {
      await api('/integrations/taobao/web/login', { method: 'DELETE' }); setLogin(null)
    })} footer={<Button onClick={() => void action(async () => {
      await api('/integrations/taobao/web/login', { method: 'DELETE' }); setLogin(null)
    })}>关闭登录窗口</Button>}>
      <div className="stack">
        <Alert tone={login.state === 'ERROR' ? 'error' : 'info'}>{login.message || '正在准备登录页面…'}</Alert>
        <small>请使用与默认 PID 对应的淘宝联盟账号。可直接点击下方官方页面切换二维码或刷新；本机运行时也可操作自动打开的浏览器窗口。</small>
        {login.screenshot && <button type="button" className="taobao-login-screen" aria-label="操作淘宝官方登录页面" onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = Math.floor((e.clientX - rect.left) / rect.width * login.width)
          const y = Math.floor((e.clientY - rect.top) / rect.height * login.height)
          void api('/integrations/taobao/web/login/click', { method: 'POST', body: JSON.stringify({ x, y }) }).catch(e => setError(errorText(e)))
        }}><img src={`data:image/jpeg;base64,${login.screenshot}`} alt="淘宝联盟官方登录页面，使用手机淘宝扫描二维码" /></button>}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>}
    {it.dirty && <small>请先保存配置，再连接或验证。</small>}
    {error && <Alert tone="error">{error}</Alert>}
    {notice && <Alert tone="success">{notice}</Alert>}
  </div>
}
