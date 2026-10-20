import { useEffect, useState } from 'react'
import { KeyRound, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { dateTime, errorText } from '../lib/format'
import { Alert, Button, Select, SplitButton, Switch, TextArea } from '../ui'
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
type Binding = { adzone: string; pid: string | null; source: 'POOL' | 'CREATED'; user: { id: string; name: string } | null; boundAt: string | null }
type Adzones = { pool: Binding[]; created: Binding[]; free: number }

/** 淘宝联盟：订单数据源、网页登录、订单测试与历史同步 */
export function TaobaoOrderPanel({ it }: { it: ReturnType<typeof useIntegration> }) {
  const effective = ((it.data as unknown as { orderSource?: Source })?.orderSource || 'official') as Source
  const source = ((it.values.orderSource as Source) || effective) as Source
  const [sync, setSync] = useState<Sync>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const savedSource = it.data?.fields.find((f) => f.key === 'orderSource')?.value || effective


  const [adzones, setAdzones] = useState<Adzones>()
  // 保存配置（如外部访问地址、推广位池）后重新读取
  useEffect(() => {
    api<Adzones>('/integrations/taobao/adzones').then(setAdzones, () => setAdzones(undefined))
  }, [it.data])
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
      <Switch
        label="每个用户独立推广位"
        checked={it.values.perUserAdzone !== 'false'}
        onChange={(v) => it.set('perUserAdzone', v ? 'true' : 'false')}
      />
      <small className="text-faint">
        用户首次转淘宝链接时固定绑定一个推广位，之后都用它转链，订单的推广位 ID 精确对应用户（归属方式「联盟标识」）。先从下方推广位池取未绑定的；池子用完且开启喵有券淘宝接入时自动创建（喵有券付费接口）；都不行时使用默认推广位，订单按商品规则匹配。
      </small>
      {it.values.perUserAdzone !== 'false' && (
        <>
          <TextArea
            label="推广位池"
            hint="在淘宝联盟后台建好推广位后填入，每行一个 PID（mm_账号_网站_推广位），需与默认 PID 同一账号；已绑定用户的推广位不能移除"
            rows={4}
            placeholder={'mm_133091730_45556678_1234567890\nmm_133091730_45556678_1234567891'}
            value={it.values.adzonePool ?? ''}
            onChange={(e) => it.set('adzonePool', e.target.value)}
          />
          {adzones && adzones.pool.length + adzones.created.length > 0 && (
            <div className="oauth-box">
              <div>
                推广位池 {adzones.pool.length} 个，空闲 {adzones.free} 个{adzones.created.length ? `；自动创建 ${adzones.created.length} 个` : ''}
              </div>
              {[...adzones.pool, ...adzones.created].map((b) => (
                <div key={b.adzone} className="text-faint">
                  {b.pid || b.adzone} · {b.user ? `${b.user.name}（${b.boundAt ? dateTime(b.boundAt) : ''} 绑定）` : '空闲'}
                  {b.source === 'CREATED' && ' · 自动创建'}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <Switch
        label="按商品自动关联下单用户"
        checked={it.values.autoMatch !== 'false'}
        onChange={(v) => it.set('autoMatch', v ? 'true' : 'false')}
      />
      <small className="text-faint">
        用默认推广位转链的订单没有用户标识：下单前 7 天内（含下单后 10 分钟）只有一个用户转过同一商品，且商品 ID 或完整标题一致时自动关联，订单标注「按商品匹配」，通知提醒用户核对；多人可能转过同一商品时不关联，需人工关联。分享出去的链接被他人下单无法识别。
      </small>

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
