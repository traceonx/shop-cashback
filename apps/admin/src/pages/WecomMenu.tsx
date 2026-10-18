import { useEffect, useState } from 'react'
import { Plus, Save, Send, X } from 'lucide-react'
import { api } from '../lib/api'
import { dateTime, errorText } from '../lib/format'
import { Alert, Button, Card, CardBody, CardHeader, IconButton, Loading, Select, TextField, confirm } from '../ui'

type Draft = { name: string; children: { name: string; action: string }[] }[]
type Data = { draft: Draft; published: null | { draft: Draft; publishedAt: string }; actions: Record<string, { label: string; command: string }> }

/** 企业微信应用菜单：编辑草稿 → 保存 → 发布，右侧手机预览 */
export function WecomMenu() {
  const [data, setData] = useState<Data>()
  const [draft, setDraft] = useState<Draft>([])
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    api<Data>('/wecom/menu')
      .then((d) => {
        setData(d)
        setDraft(d.draft)
      })
      .catch((e) => setError(errorText(e)))
  }, [])
  const dirty = !!data && JSON.stringify(draft) !== JSON.stringify(data.draft)
  const change = (edit: (copy: Draft) => void) => {
    const copy = structuredClone(draft)
    edit(copy)
    setDraft(copy)
    setNotice('')
  }
  async function submit(publish: boolean) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await api<Data>(publish ? '/wecom/menu/publish' : '/wecom/menu', {
        method: publish ? 'POST' : 'PUT',
        body: JSON.stringify({ draft }),
      })
      setData(next)
      setNotice(publish ? '已发布到企业微信，客户端可能需要重新进入应用才能看到' : '草稿已保存，尚未发布')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const actions = data ? Object.entries(data.actions).map(([k, a]): [string, string] => [k, a.label]) : []

  return (
    <Card>
      <CardHeader
        title="应用菜单"
        subtitle={`${data?.published ? `上次发布 ${dateTime(data.published.publishedAt)}` : '尚未发布'} · 最多 3 个一级菜单，每个最多 5 个子菜单`}
        actions={
          <>
            <Button variant="outlined" icon={Save} disabled={busy || !dirty} onClick={() => submit(false)}>
              保存草稿
            </Button>
            <Button variant="primary" icon={Send} loading={busy} disabled={dirty} onClick={async () => {
              if (await confirm({ title: '发布菜单', content: '发布会覆盖企业微信应用当前的菜单。', okText: '发布' })) void submit(true)
            }}>
              发布
            </Button>
          </>
        }
      />
      <CardBody>
        {!data ? (
          error ? <Alert tone="error">{error}</Alert> : <Loading />
        ) : (
          <div className="menu-editor">
            <fieldset className="stack" disabled={busy}>
              {error && <Alert tone="error">{error}</Alert>}
              {notice && <Alert tone="success">{notice}</Alert>}
              {draft.map((group, i) => (
                <div className="menu-group" key={i}>
                  <div className="row">
                    <TextField dense className="spacer" label={`一级菜单 ${i + 1}`} value={group.name} onChange={(e) => change((d) => void (d[i].name = e.target.value))} />
                    <IconButton icon={X} label="移除一级菜单" disabled={draft.length <= 1} onClick={() => (change((d) => void d.splice(i, 1)), setSelected(0))} />
                  </div>
                  {group.children.map((child, j) => (
                    <div className="menu-child" key={j}>
                      <TextField dense aria-label="子菜单名称" value={child.name} onChange={(e) => change((d) => void (d[i].children[j].name = e.target.value))} />
                      <Select dense aria-label="功能" value={child.action} options={actions} onChange={(v) => change((d) => void (d[i].children[j].action = v))} />
                      <IconButton icon={X} label="移除子菜单" size="sm" disabled={group.children.length <= 1} onClick={() => change((d) => void d[i].children.splice(j, 1))} />
                    </div>
                  ))}
                  <Button variant="text" size="sm" icon={Plus} disabled={group.children.length >= 5} onClick={() => change((d) => void d[i].children.push({ name: '使用帮助', action: 'HELP' }))}>
                    子菜单
                  </Button>
                </div>
              ))}
              <Button variant="tonal" icon={Plus} disabled={draft.length >= 3} onClick={() => change((d) => void d.push({ name: '新菜单', children: [{ name: '使用帮助', action: 'HELP' }] }))}>
                一级菜单
              </Button>
            </fieldset>
            <aside className="phone" aria-label="菜单预览">
              <header>返利助手</header>
              <div className="phone-body">
                <div className="phone-bubble">发送商品链接，查询优惠和预计返现。</div>
              </div>
              <div className="phone-submenu">
                {draft[selected]?.children.map((c, i) => (
                  <div key={i}>{c.name || '未命名'}</div>
                ))}
              </div>
              <nav className="phone-nav">
                {draft.map((g, i) => (
                  <button key={i} type="button" aria-pressed={selected === i} onClick={() => setSelected(i)}>
                    {g.name || '未命名'}
                  </button>
                ))}
              </nav>
            </aside>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
