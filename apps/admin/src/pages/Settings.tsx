import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Percent, Save, Wallet } from 'lucide-react'
import { api } from '../lib/api'
import { errorText, type Notify } from '../lib/format'
import { Alert, Button, Card, CardBody, CardHeader, Loading, Tabs, TextField } from '../ui'
import { SystemUpdate } from './SystemUpdate'

type Tab = 'rules' | 'update'
const tabs: { value: Tab; label: string; icon: typeof Box }[] = [
  { value: 'rules', label: '返现规则', icon: Percent },
  { value: 'update', label: '版本更新', icon: Box },
]

export function Settings({ notify }: { notify: Notify }) {
  const [params, setParams] = useSearchParams()
  const tab = (tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'rules') as Tab
  return (
    <>
      <Tabs items={tabs} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'rules' && <Rules notify={notify} />}
      {tab === 'update' && <SystemUpdate />}
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
