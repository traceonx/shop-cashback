import { useEffect, useState } from 'react'
import { KeyRound, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { dateTime, errorText } from '../lib/format'
import { Alert, Button, Select, SplitButton } from '../ui'
import type { useIntegration } from './integration'
import { TaobaoWebPanel } from './TaobaoWebPanel'

type Source = 'official' | 'ecapi'
const sources: [Source, string][] = [
  ['official', '官方推广者（taobao.tbk.order.details.get）'],
  ['ecapi', '喵有券（tbkOrderDetailsGet）'],
]

type Sync = { status: string; count: number; windows: number; total: number; error?: string | null; lastSyncedAt?: string | null; auto?: boolean } | null

const ranges: [string, string][] = [
  ['24', '最近 24 小时'],
  ['168', '最近 7 天'],
  ['720', '最近 30 天'],
  ['2160', '最近 90 天'],
]

/** 淘宝联盟：订单数据源、网页登录、订单测试与历史同步 */
export function TaobaoOrderPanel({ it }: { it: ReturnType<typeof useIntegration> }) {
  const effective = ((it.data as unknown as { orderSource?: Source })?.orderSource || 'official') as Source
  const source = ((it.values.orderSource as Source) || effective) as Source
  const [sync, setSync] = useState<Sync>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const savedSource = it.data?.fields.find((f) => f.key === 'orderSource')?.value || effective
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
  const test = () =>
    run('test', async () => {
      const r = await api<{ count: number; hasMore: boolean }>('/integrations/taobao/orders/test', { method: 'POST' })
      return `订单查询成功：本次返回订单 ${r.count} 条${r.hasMore ? '（还有更多）' : ''}`
    })
  const syncHistory = (hours = '24') =>
    run('sync', async () => {
      const r = await api<{ message: string }>('/orders/sync', { method: 'POST', body: JSON.stringify({ platform: 'taobao', hours: Number(hours) }) })
      return r.message
    })

  const running = sync && ['QUEUED', 'RUNNING'].includes(sync.status)
  return (
    <div className="stack">
      <TaobaoWebPanel it={it} />
      <Select<Source>
        label="订单数据源"
        hint="与转链数据源分开配置；切换数据源不会重复入库（按订单号与子订单号去重）"
        value={source}
        options={sources}
        onChange={(v) => it.set('orderSource', v)}
      />
      <small className="text-faint">每个用户独立推广位与推广位池在「推广位管理」中配置。</small>

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
