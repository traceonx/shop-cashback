import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, FileText, KeyRound, Percent, Save, ScrollText, ShieldCheck, Wallet } from 'lucide-react'
import { api, auth, type Row } from '../lib/api'
import { dateTime, errorText, type Notify } from '../lib/format'
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, Loading, Tabs, TextField } from '../ui'
import { SystemUpdate } from './SystemUpdate'

type Tab = 'rules' | 'security' | 'update' | 'audit'
const tabs: { value: Tab; label: string; icon: typeof Box }[] = [
  { value: 'rules', label: '返现规则', icon: Percent },
  { value: 'security', label: '账户安全', icon: ShieldCheck },
  { value: 'update', label: '版本更新', icon: Box },
  { value: 'audit', label: '操作审计', icon: ScrollText },
]

export function Settings({ notify }: { notify: Notify }) {
  const [params, setParams] = useSearchParams()
  const tab = (tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'rules') as Tab
  return (
    <>
      <Tabs items={tabs} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'rules' && <Rules notify={notify} />}
      {tab === 'security' && <ChangePassword notify={notify} />}
      {tab === 'update' && <SystemUpdate />}
      {tab === 'audit' && <Audit />}
    </>
  )
}

function Rules({ notify }: { notify: Notify }) {
  const [ratio, setRatio] = useState<number>()
  const [minimum, setMinimum] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    api<{ ratio: number; minimum: number }>('/settings')
      .then((r) => {
        setRatio(r.ratio)
        setMinimum(r.minimum)
      })
      .catch((e) => setError(errorText(e)))
  }, [])
  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ ratio, minimum }) })
      notify('规则已保存，历史订单不受影响')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader title="返现与提现" subtitle="历史订单按下单时的比例快照计算；用户专属比例优先于全局比例" />
      <CardBody>
        {ratio === undefined ? (
          error ? <Alert tone="error">{error}</Alert> : <Loading />
        ) : (
          <form className="stack" onSubmit={save}>
            <div className="grid-2">
              <TextField
                label="全局返现比例（%）"
                icon={Percent}
                type="number"
                min={0}
                max={100}
                required
                hint="预计返现 = 有效佣金 × 返现比例"
                value={ratio}
                onChange={(e) => setRatio(Number(e.target.value))}
              />
              <TextField
                label="最低提现金额（元）"
                icon={Wallet}
                type="number"
                min={1}
                max={100000}
                required
                hint="用户在企业微信发送 /提现 申请，需人工审核与打款"
                value={minimum}
                onChange={(e) => setMinimum(Number(e.target.value))}
              />
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <div>
              <Button type="submit" variant="primary" icon={Save} loading={busy}>
                保存
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  )
}

function ChangePassword({ notify }: { notify: Notify }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (next !== confirm) return setError('两次输入的新密码不一致')
    setBusy(true)
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) })
      notify('密码已修改，请重新登录')
      auth.clear()
      window.dispatchEvent(new Event('session-expired'))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader title="修改密码" subtitle="修改后所有设备上的登录都会失效" />
      <CardBody>
        <form className="stack form-narrow" onSubmit={save}>
          <TextField label="当前密码" icon={KeyRound} secret autoComplete="current-password" required maxLength={256} value={current} onChange={(e) => setCurrent(e.target.value)} />
          <TextField label="新密码" icon={KeyRound} secret autoComplete="new-password" required maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} />
          <TextField label="确认新密码" icon={KeyRound} secret autoComplete="new-password" required maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && <Alert tone="error">{error}</Alert>}
          <div>
            <Button type="submit" variant="primary" icon={Save} loading={busy}>
              修改密码
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

function Audit() {
  const [logs, setLogs] = useState<Row[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    api<Row[]>('/audit-logs')
      .then(setLogs)
      .catch((e) => setError(errorText(e)))
  }, [])
  return (
    <Card>
      <CardHeader title="操作审计" subtitle="后台操作记录持久保存" />
      <CardBody flush>
        {error ? (
          <div className="card-body">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : !logs ? (
          <Loading />
        ) : logs.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>操作</th>
                  <th>对象</th>
                  <th>操作人</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((r) => (
                  <tr key={r.id}>
                    <td>{String(r.action)}</td>
                    <td className="text-mono">{String(r.target)}</td>
                    <td>{String(r.actor)}</td>
                    <td className="text-muted nowrap">{dateTime(String(r.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={FileText} title="暂无操作记录" description="修改规则、用户或审核提现后会记录在这里" />
        )}
      </CardBody>
    </Card>
  )
}
