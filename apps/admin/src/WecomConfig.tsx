import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Building2, AppWindow, KeyRound, Server, Key, Lock, Users, Tag, Settings, X, Link2, Copy, Save, Loader2, RefreshCw } from 'lucide-react'
import { api } from './api'

type Field = { key: string; label: string; secret: boolean; value: string; configured: boolean }
type Data = { configured: boolean; fields: Field[]; test: null | { status: string; message: string; checkedAt: string }; callbackPath: string }

// 布局与说明参照 MoviePilot 企业微信通知配置
const layout: { key: string; label: string; hint: string; icon: ReactNode }[][] = [
  [
    { key: 'corpId', label: '企业ID', hint: '企业微信后台企业信息中的企业ID', icon: <Building2 size={20} /> },
    { key: 'agentId', label: '应用 AgentId', hint: '企业微信自建应用的AgentId', icon: <AppWindow size={20} /> },
  ],
  [
    { key: 'secret', label: '应用 Secret', hint: '企业微信自建应用的Secret', icon: <KeyRound size={20} /> },
    { key: 'proxy', label: '代理地址', hint: '微信消息的转发代理地址，2022年6月20日后创建的自建应用才需要，不使用代理时需要保留为空', icon: <Server size={20} /> },
  ],
  [
    { key: 'token', label: 'Token', hint: '微信企业自建应用 → API接收消息配置中的Token', icon: <Key size={20} /> },
    { key: 'aesKey', label: 'EncodingAESKey', hint: '微信企业自建应用 → API接收消息配置中的EncodingAESKey', icon: <Lock size={20} /> },
  ],
  [
    { key: 'adminUserId', label: '管理员通知 UserID', hint: '接收系统通知的企业微信成员账号（通讯录中的“账号”）', icon: <Users size={20} /> },
  ],
]

export function WecomConfig({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Data>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const fill = (d: Data) => {
    setData(d)
    setValues(Object.fromEntries(d.fields.map((f) => [f.key, f.value])))
  }
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    api<Data>('/integrations/wecom/details', { method: 'POST' }).then(fill).catch((e) => setError(e.message))
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const field = (key: string) => data?.fields.find((f) => f.key === key)
  const dirty = !!data && data.fields.some((f) => (values[f.key] || '') !== (f.value || ''))
  const enabled = values.enabled !== 'false'
  const callbackUrl = `${location.origin}${data?.callbackPath || '/api/v1/callbacks/wecom'}`

  async function save() {
    setBusy(true); setError(''); setNotice('')
    try {
      await api('/integrations/wecom', { method: 'PUT', body: JSON.stringify(values) })
      fill(await api<Data>('/integrations/wecom/details', { method: 'POST' }))
      setNotice('配置已保存')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function test() {
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await api<NonNullable<Data['test']>>('/integrations/wecom/test', { method: 'POST' })
      setData((d) => (d ? { ...d, test: r } : d))
      if (r.status === 'CONNECTED') setNotice(r.message)
      else setError(r.message)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const set = (key: string, value: string) => { setValues({ ...values, [key]: value }); setNotice('') }

  const input = (f: (typeof layout)[number][number]) => {
    const meta = field(f.key)
    if (!meta) return null
    return (
      <div className="mp-cell" key={f.key}>
        <label className="mp-field">
          <span className="mp-label">{f.label}</span>
          <span className="mp-icon">{f.icon}</span>
          <input
            type={meta.secret && !shown[f.key] ? 'password' : 'text'}
            value={values[f.key] || ''}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={meta.secret && meta.configured ? '已保存，输入新值以替换' : ''}
            autoComplete="off"
            spellCheck={false}
            maxLength={2000}
          />
          {meta.secret && (
            <button type="button" className="mp-eye" onClick={() => setShown({ ...shown, [f.key]: !shown[f.key] })}>
              {shown[f.key] ? '隐藏' : '显示'}
            </button>
          )}
        </label>
        <p className="mp-hint">{f.hint}</p>
      </div>
    )
  }

  return (
    <div className="mp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="mp-dialog" role="dialog" aria-modal="true" aria-label="企业微信配置">
        <header className="mp-head">
          <Settings size={24} />
          <div>
            <h2>配置</h2>
            <p>{values.name || '企业微信'}</p>
          </div>
          <button type="button" className="mp-close" onClick={onClose} aria-label="关闭"><X size={22} /></button>
        </header>
        <div className="mp-body">
          {!data ? (
            error ? <p className="error-box" role="alert">{error}</p> : <p className="muted"><Loader2 className="spin" size={16} /> 正在读取配置…</p>
          ) : (
            <>
              <label className="mp-switch-row">
                <button type="button" role="switch" aria-checked={enabled} className={'mp-switch' + (enabled ? ' on' : '')} onClick={() => set('enabled', enabled ? 'false' : 'true')}><i /></button>
                启用
              </label>
              <div className="mp-grid">
                <div className="mp-cell">
                  <label className="mp-field">
                    <span className="mp-label">名称</span>
                    <span className="mp-icon"><Tag size={20} /></span>
                    <input value={values.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="企业微信" maxLength={40} />
                  </label>
                  <p className="mp-hint">通知渠道名称</p>
                </div>
                <div className="mp-cell">
                  <div className="mp-field readonly">
                    <span className="mp-label">回调地址</span>
                    <span className="mp-icon"><Link2 size={20} /></span>
                    <input readOnly value={callbackUrl} onFocus={(e) => e.target.select()} />
                    <button type="button" className="mp-eye" onClick={() => navigator.clipboard?.writeText(callbackUrl).then(() => setNotice('回调地址已复制'))}><Copy size={15} /></button>
                  </div>
                  <p className="mp-hint">填到企业微信自建应用 → API接收消息的 URL；需公网 HTTPS 可访问</p>
                </div>
                {layout.flat().map(input)}
              </div>
              {error && <p className="error-box" role="alert">{error}</p>}
              {notice && <p className="save-success" role="status">{notice}</p>}
              {data.test && !notice && !error && (
                <p className="mp-hint">上次测试 {new Date(data.test.checkedAt).toLocaleString('zh-CN', { hour12: false })}：{data.test.message}</p>
              )}
            </>
          )}
        </div>
        <footer className="mp-foot">
          <button type="button" className="mp-btn ghost" disabled={!data || busy || dirty || !data.configured} onClick={test} title={dirty ? '请先保存再测试' : ''}>
            <RefreshCw size={16} />测试连接
          </button>
          <button type="button" className="mp-btn primary" disabled={!data || busy || !dirty} onClick={save}>
            {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}确认
          </button>
        </footer>
      </div>
    </div>
  )
}
