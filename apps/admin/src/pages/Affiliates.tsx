import { useState } from 'react'
import { ExternalLink, Hash, KeyRound, RefreshCw, Save, ShoppingBag, Store, Tag } from 'lucide-react'
import { Alert, Button, Loading, Modal, Switch, TextField } from '../ui'
import { dateTime } from '../lib/format'
import { ProviderTile, useIntegration, type IntegrationKind } from './integration'

type Affiliate = Exclude<IntegrationKind, 'wecom' | 'jd-ecapi' | 'taobao-ecapi'>
const meta: Record<
  Affiliate,
  { name: string; description: string; doc: string; testLabel: string; fields: { key: string; hint: string; icon: typeof Tag; readOnly?: boolean }[]; steps: string[] }
> = {
  jd: {
    name: '京东联盟',
    description: '商品转链、订单同步',
    doc: 'https://union.jd.com/openplatform/api/12707',
    testLabel: '测试订单查询',
    fields: [
      { key: 'appKey', hint: '京东联盟开放平台应用的 AppKey', icon: KeyRound },
      { key: 'appSecret', hint: '应用的 AppSecret', icon: KeyRound },
      { key: 'unionId', hint: '联盟 ID', icon: Hash },
      { key: 'positionId', hint: '推广位 ID', icon: Tag },
      { key: 'siteId', hint: '网站 / APP 媒体 ID，仅转链使用', icon: Store },
    ],
    steps: ['只需应用凭证，不收集京东登录密码', '订单查询只需 AppKey 与 AppSecret', '订单归属未核实前不会自动入账返现'],
  },
  taobao: {
    name: '淘宝联盟',
    description: '商品转链、淘口令',
    doc: 'https://developer.alibaba.com/docs/api.htm?apiId=65409',
    testLabel: '测试接口权限',
    fields: [
      { key: 'appKey', hint: '淘宝联盟开放平台应用的 AppKey', icon: KeyRound },
      { key: 'appSecret', hint: '应用的 AppSecret', icon: KeyRound },
      { key: 'pid', hint: '完整 PID，如 mm_1_2_3，保存时自动提取推广位 ID', icon: Tag },
      { key: 'adzoneId', hint: '由 PID 自动提取', icon: Hash, readOnly: true },
    ],
    steps: ['未开通万能转链时自动按分享标题搜索转链', '同名商品多家店铺在卖时不转链，避免串店', '订单同步需另行申请订单查询权限'],
  },
}

function AffiliateCard({ kind }: { kind: Affiliate }) {
  const it = useIntegration(kind)
  const [open, setOpen] = useState(false)
  const m = meta[kind]
  const close = () => {
    if (it.busy) return
    setOpen(false)
    void it.summary()
  }
  return (
    <>
      <ProviderTile
        platform={kind}
        icon={ShoppingBag}
        name={m.name}
        tag="官方"
        description={m.description}
        status={it.status}
        loading={it.loading && !open}
        onClick={() => {
          setOpen(true)
          void it.details()
        }}
      />
      {open && (
        <Modal
          title={m.name}
          subtitle="配置加密保存，密钥默认隐藏"
          icon={ShoppingBag}
          size="md"
          dismissible={!it.busy}
          onClose={close}
          actions={
            <Button variant="text" size="sm" onClick={() => window.open(m.doc, '_blank', 'noopener')}>
              接口文档 <ExternalLink size={14} />
            </Button>
          }
          footerNote={it.dirty ? '有未保存的修改，保存后再测试' : it.data?.test ? `上次测试 ${dateTime(it.data.test.checkedAt)}` : undefined}
          footer={
            <>
              <Button variant="outlined" icon={RefreshCw} disabled={it.busy || it.dirty || !it.data?.configured} onClick={it.test}>
                {m.testLabel}
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
              <div className="grid-2">
                {m.fields.map(({ key, hint, icon, readOnly }) => {
                  const f = it.field(key)
                  if (!f) return null
                  return (
                    <TextField
                      key={key}
                      label={f.label}
                      hint={hint}
                      icon={icon}
                      secret={f.secret}
                      readOnly={readOnly}
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
              <ul className="note-list">
                {m.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}

// 喵有券第三方接入：独立配置，开关决定该平台链接是否改走喵有券；官方接入不受影响
type ThirdKind = Extract<IntegrationKind, 'jd-ecapi' | 'taobao-ecapi'>
const thirdMeta: Record<
  ThirdKind,
  { platform: string; name: string; summary: string; switchLabel: string; doc: string; fields: { key: string; hint: string; icon: typeof Tag }[]; steps: string[] }
> = {
  'jd-ecapi': {
    platform: 'jd',
    name: '京东联盟 · 喵有券',
    summary: '通过喵有券查券转链',
    switchLabel: '启用（京东链接改走喵有券）',
    doc: 'https://www.ecapi.cn/index/index/openapi/id/56.shtml?ptype=2',
    fields: [
      { key: 'apiKey', hint: '喵有券控制台「平台设置」中的 apkey', icon: KeyRound },
      { key: 'keyId', hint: '喵有券「京东授权列表」中的调用 Key', icon: KeyRound },
      { key: 'positionId', hint: '不填时喵有券自动生成专用推广位', icon: Tag },
    ],
    steps: [
      '先在喵有券「京东授权列表」授权你自己的京东联盟账号，推广订单归属该账号',
      '把服务器公网出口 IP 加入喵有券白名单，否则返回错误码 401',
      '启用后京东链接改由喵有券查券转链；关闭则继续使用京东联盟官方接入',
      '订单同步仍使用京东联盟官方 AppKey / AppSecret，请保留官方配置',
      '子联盟 ID（subUnionId）需在喵有券另行申请，未开通时订单按商品匹配用户',
    ],
  },
  'taobao-ecapi': {
    platform: 'taobao',
    name: '淘宝联盟 · 喵有券',
    summary: '喵有券解析商品 + 官方查价转链',
    switchLabel: '启用（淘宝链接改走喵有券 + 官方混合转链）',
    doc: 'https://www.ecapi.cn/index/index/openapi/id/330.shtml?ptype=1',
    fields: [
      { key: 'apiKey', hint: '喵有券控制台「平台设置」中的 apkey（可与京东共用）', icon: KeyRound },
      { key: 'tbname', hint: '喵有券「账号授权」中已授权的淘宝用户名', icon: Hash },
    ],
    steps: [
      '先在喵有券「账号授权」授权你的淘宝联盟账号，推广位使用淘宝联盟（官方）中填写的 PID',
      '把服务器公网出口 IP 加入喵有券白名单；万能解析为喵有券付费会员接口',
      '流程：喵有券万能转链 → 万能解析取新版商品 ID → 官方物料查询取价格、券、佣金和推广链接',
      '每个新商品调用喵有券 2 次，同一商品 24 小时内只查官方；不要在喵有券设置默认渠道 ID',
      '需保留淘宝联盟（官方）的 AppKey、AppSecret 与 PID；关闭开关则仍走官方接入',
    ],
  },
}

function ThirdPartyCard({ kind }: { kind: ThirdKind }) {
  const m = thirdMeta[kind]
  const it = useIntegration(kind)
  const [open, setOpen] = useState(false)
  const enabled = it.values.enabled === 'true'
  const close = () => {
    if (it.busy) return
    setOpen(false)
    void it.summary()
  }
  const on = it.data?.fields.find((f) => f.key === 'enabled')?.value === 'true'
  return (
    <>
      <ProviderTile
        platform={m.platform}
        icon={ShoppingBag}
        name={m.name}
        tag="第三方"
        description={`${m.summary} · ${on ? '已启用' : '未启用'}`}
        status={it.status}
        loading={it.loading && !open}
        onClick={() => {
          setOpen(true)
          void it.details()
        }}
      />
      {open && (
        <Modal
          title={`${m.name}（第三方）`}
          subtitle="第三方服务商喵有券（ecapi.cn），配置加密保存，密钥默认隐藏"
          icon={ShoppingBag}
          size="md"
          dismissible={!it.busy}
          onClose={close}
          actions={
            <Button variant="text" size="sm" onClick={() => window.open(m.doc, '_blank', 'noopener')}>
              接口文档 <ExternalLink size={14} />
            </Button>
          }
          footerNote={it.dirty ? '有未保存的修改，保存后再测试' : it.data?.test ? `上次测试 ${dateTime(it.data.test.checkedAt)}` : undefined}
          footer={
            <>
              <Button variant="outlined" icon={RefreshCw} disabled={it.busy || it.dirty || !it.data?.configured} onClick={it.test}>
                测试接口
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
              <Switch label={m.switchLabel} checked={enabled} onChange={(v) => it.set('enabled', v ? 'true' : 'false')} />
              <div className="grid-2">
                {m.fields.map(({ key, hint, icon }) => {
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
              <ul className="note-list">
                {m.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}

export function Affiliates() {
  return (
    <div className="tile-grid">
      <AffiliateCard kind="jd" />
      <ThirdPartyCard kind="jd-ecapi" />
      <AffiliateCard kind="taobao" />
      <ThirdPartyCard kind="taobao-ecapi" />
    </div>
  )
}
