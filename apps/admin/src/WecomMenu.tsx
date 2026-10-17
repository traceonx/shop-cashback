import { useEffect, useState } from 'react'
import { api } from './api'

type Draft = { name: string; children: { name: string; action: string }[] }[]
type Data = { draft: Draft; published: null | { draft: Draft; publishedAt: string }; actions: Record<string, { label: string; command: string }> }
export function WecomMenu() {
  const [data, setData] = useState<Data>(), [draft, setDraft] = useState<Draft>([]), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [selected, setSelected] = useState(0)
  useEffect(() => { api<Data>('/wecom/menu').then((d) => { setData(d); setDraft(d.draft) }).catch((e) => setError(e.message)) }, [])
  const dirty = !!data && JSON.stringify(draft) !== JSON.stringify(data.draft)
  function change(edit: (copy: Draft) => void) { const copy = structuredClone(draft); edit(copy); setDraft(copy); setNotice('') }
  async function submit(publish: boolean) {
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await api<Data>(publish ? '/wecom/menu/publish' : '/wecom/menu', { method: publish ? 'POST' : 'PUT', body: JSON.stringify({ draft }) })
      setData(next); setNotice(publish ? '已发布到企业微信。客户端菜单刷新可能有延迟，请重新进入应用查看。' : '草稿已保存，尚未发布到企业微信。')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <section className="panel wecom-menu-panel">
    <div className="menu-section-heading"><div><h2>应用菜单</h2><p className="muted">先保存草稿，再发布到企业微信。发布会覆盖当前应用菜单；点击菜单通过已配置的消息回调回复。</p></div></div>
    {error && <p className="error-box" role="alert">{error}</p>}
    {notice && <p className="save-success" role="status">{notice}</p>}
    {!data ? <p>正在读取菜单配置…</p> : <>
      <div className="menu-editor-layout">
        <fieldset disabled={busy} className="menu-editor-fields">
          {draft.map((group, i) => <div className="menu-group" key={i}>
            <div className="menu-group-title"><label>一级菜单 {i + 1}<input aria-label={`一级菜单 ${i + 1} 名称`} value={group.name} onChange={(e) => change((d) => { d[i].name = e.target.value })} /></label><button type="button" className="button" disabled={draft.length <= 1} onClick={() => { change((d) => { d.splice(i, 1) }); setSelected(0) }}>移除</button></div>
            {group.children.map((child, j) => <div className="menu-child" key={j}>
              <input aria-label={`${group.name} 子菜单 ${j + 1} 名称`} value={child.name} onChange={(e) => change((d) => { d[i].children[j].name = e.target.value })} />
              <select aria-label={`${child.name} 功能`} value={child.action} onChange={(e) => change((d) => { d[i].children[j].action = e.target.value })}>{Object.entries(data.actions).map(([key, action]) => <option key={key} value={key}>{action.label}</option>)}</select>
              <button type="button" className="icon-button" aria-label={`移除 ${child.name}`} disabled={group.children.length <= 1} onClick={() => change((d) => { d[i].children.splice(j, 1) })}>×</button>
            </div>)}
            <button type="button" className="button" disabled={group.children.length >= 5} onClick={() => change((d) => { d[i].children.push({ name: '使用帮助', action: 'HELP' }) })}>＋ 子菜单</button>
          </div>)}
          <button type="button" className="button" disabled={draft.length >= 3} onClick={() => change((d) => { d.push({ name: '新菜单', children: [{ name: '使用帮助', action: 'HELP' }] }) })}>＋ 一级菜单</button>
        </fieldset>
        <aside className="menu-phone"><header>企业微信 · 返利助手</header><div className="menu-phone-message">发送商品链接查询优惠和预计返现。<br /><br />点击底部菜单查询自己的订单与账户。<p className="muted">订单找回、提现申请暂未开放，点击后会说明当前状态。</p></div><div className="menu-phone-spacer" /><div className="menu-preview-children">{draft[selected]?.children.map((c, i) => <div key={i}>{c.name || '未命名'}</div>)}</div><nav className="menu-phone-nav">{draft.map((g, i) => <button key={i} className={selected === i ? 'active' : ''} onClick={() => setSelected(i)}>{g.name || '未命名'}</button>)}</nav></aside>
      </div>
      <p className="muted">最多 3 个一级菜单，每个最多 5 个子菜单。名称限制：一级 16 字节，二级 40 字节。</p>
      <div className="integration-footer"><span>{data.published ? `上次发布：${new Date(data.published.publishedAt).toLocaleString('zh-CN')}` : '尚未发布'}{dirty ? ' · 有未保存修改' : ''}</span><div className="menu-buttons"><button className="button" disabled={busy || !dirty} onClick={() => submit(false)}>保存草稿</button><button className="primary" disabled={busy || dirty} onClick={() => submit(true)}>{busy ? '处理中…' : '发布到企业微信'}</button></div></div>
    </>}
  </section>
}
