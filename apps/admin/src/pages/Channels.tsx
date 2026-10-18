import { useState } from 'react'
import { AppWindow, Bot, Building2, Copy, Key, KeyRound, Link2, Lock, RefreshCw, Save, Server, Tag, Users } from 'lucide-react'
import { Alert, Button, Loading, Modal, Switch, TextField } from '../ui'
import { dateTime } from '../lib/format'
import { ProviderTile, useIntegration } from './integration'
import { WecomMenu } from './WecomMenu'

// 字段与说明参照 MoviePilot 企业微信通知配置
const fields: { key: string; hint: string; icon: typeof Tag }[] = [
  { key: 'corpId', hint: '企业微信后台「我的企业」中的企业ID', icon: Building2 },
  { key: 'agentId', hint: '自建应用的 AgentId', icon: AppWindow },
  { key: 'secret', hint: '自建应用的 Secret', icon: KeyRound },
  { key: 'proxy', hint: '2022 年 6 月 20 日后创建的应用如需固定出口 IP，可填转发代理地址；不使用请留空', icon: Server },
  { key: 'token', hint: '应用 → API 接收消息中的 Token', icon: Key },
  { key: 'aesKey', hint: '应用 → API 接收消息中的 EncodingAESKey', icon: Lock },
  { key: 'adminUserId', hint: '接收系统通知的成员账号（通讯录中的「账号」）', icon: Users },
]

function WecomCard() {
  const it = useIntegration('wecom')
  const [open, setOpen] = useState(false)
  const callbackUrl = `${location.origin}${it.data?.callbackPath || '/api/v1/callbacks/wecom'}`
  const enabled = it.values.enabled !== 'false'
  const close = () => {
    if (it.busy) return
    setOpen(false)
    void it.summary()
  }
  return (
    <>
      <ProviderTile
        platform="wecom"
        icon={Bot}
        name={it.data?.fields.find((f) => f.key === 'name')?.value || '企业微信'}
        description="接收用户消息、自动回复转链结果"
        status={it.status}
        loading={it.loading && !open}
        onClick={() => {
          setOpen(true)
          void it.details()
        }}
      />
      {open && (
        <Modal
          title="企业微信"
          subtitle={it.values.name || '自建应用'}
          icon={Bot}
          size="md"
          dismissible={!it.busy}
          onClose={close}
          footerNote={it.dirty ? '有未保存的修改，保存后再测试' : it.data?.test ? `上次测试 ${dateTime(it.data.test.checkedAt)}` : undefined}
          footer={
            <>
              <Button variant="outlined" icon={RefreshCw} disabled={it.busy || it.dirty || !it.data?.configured} onClick={it.test}>
                测试连接
              </Button>
              <Button variant="primary" icon={Save} loading={it.busy} disabled={!it.dirty} onClick={it.save}>
                保存
              </Button>
            </>
          }
        >
          {it.loading || !it.data ? (
            it.error ? <Alert tone="error">{it.error}</Alert> : <Loading text="正在读取配置…" />
          ) : (
            <div className="stack">
              <Switch label="启用" checked={enabled} onChange={(v) => it.set('enabled', v ? 'true' : 'false')} />
              <div className="grid-2">
                <TextField label="名称" icon={Tag} hint="通知渠道名称" maxLength={40} placeholder="企业微信" value={it.values.name ?? ''} onChange={(e) => it.set('name', e.target.value)} />
                <TextField
                  label="回调地址"
                  icon={Link2}
                  hint="填到应用 → API 接收消息的 URL，需公网 HTTPS 可访问"
                  readOnly
                  value={callbackUrl}
                  onFocus={(e) => e.target.select()}
                  trailing={
                    <button type="button" className="btn btn-text" aria-label="复制回调地址" onClick={() => navigator.clipboard?.writeText(callbackUrl)}>
                      <Copy size={15} />
                    </button>
                  }
                />
                {fields.map(({ key, hint, icon }) => {
                  const f = it.field(key)
                  if (!f) return null
                  return (
                    <TextField
                      key={key}
                      label={f.label}
                      hint={hint}
                      icon={icon}
                      secret={f.secret}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={2000}
                      placeholder={f.secret && f.configured ? '已保存，输入新值以替换' : ''}
                      value={it.values[key] ?? ''}
                      onChange={(e) => it.set(key, e.target.value)}
                    />
                  )
                })}
              </div>
              {it.error && <Alert tone="error">{it.error}</Alert>}
              {it.notice && <Alert tone="success">{it.notice}</Alert>}
              {!it.error && !it.notice && it.data.test && <Alert tone={it.data.test.status === 'CONNECTED' ? 'success' : 'warning'}>{it.data.test.message}</Alert>}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}

export function Channels() {
  return (
    <>
      <div className="tile-grid">
        <WecomCard />
      </div>
      <WecomMenu />
    </>
  )
}
