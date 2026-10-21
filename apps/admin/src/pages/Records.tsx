import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, Check, CheckCheck, ChevronRight, CircleCheck, Clock3, RefreshCw, Search, X } from 'lucide-react'
import { api, type Row } from '../lib/api'
import { amount, errorText, money, type Notify } from '../lib/format'
import { statusLabel } from '../lib/labels'
import { Alert, Avatar, Button, Card, CardBody, Chip, EmptyState, IconButton, Loading, Modal, Pagination, PlatformTag, confirm, Select, SplitButton, DatePicker, StatCard, StatusChip, TextArea, TextField } from '../ui'
import { ConversionCard } from './Conversion'
import { ProductCell } from './shared'

export type RecordKind = 'orders' | 'users' | 'rebates' | 'withdrawals' | 'promotions'
/** 第三项为 true 时只在详情弹窗里显示，列表不展示 */
type Column = [key: string, label: string, detailOnly?: boolean]

const config: Record<RecordKind, { title: string; columns: Column[] }> = {
  promotions: {
    title: '转链记录',
    columns: [
      ['product', '商品'],
      ['user', '用户'],
      ['price', '售价'],
      ['rebate', '预计返现'],
      ['status', '状态'],
      ['createdAt', '时间'],
    ],
  },
  orders: {
    title: '订单列表',
    columns: [
      ['product', '商品'],
      ['user', '返现用户'],
      ['paidAmount', '付款金额'],
      ['commission', '佣金'],
      ['rebate', '预计返现'],
      ['ratio', '返现比例', true],
      ['status', '状态'],
      ['times', '时间'],
      ['settlement', '结算'],
      ['createdAt', '下单时间', true],
      ['completedAt', '完成时间', true],
      ['settledAt', '佣金结算时间', true],
      ['externalOrderId', '订单号', true],
      ['positionId', '推广位 ID', true],
    ],
  },
  users: {
    title: '用户列表',
    columns: [
      ['name', '用户'],
      ['channel', '来源'],
      ['conversions', '转链次数'],
      ['orders', '订单数'],
      ['taobaoPid', '淘宝 PID'],
      ['jdPosition', '京东推广位'],
      ['balance', '可提现余额'],
      ['ratio', '返现比例', true],
      ['status', '状态'],
    ],
  },
  rebates: {
    title: '资金流水',
    columns: [
      ['id', '流水号'],
      ['user', '用户'],
      ['type', '类型'],
      ['amount', '变动金额'],
      ['before', '变更前'],
      ['after', '变更后'],
      ['createdAt', '时间'],
    ],
  },
  withdrawals: {
    title: '提现申请',
    columns: [
      ['id', '申请编号'],
      ['user', '用户'],
      ['amount', '金额'],
      ['status', '状态'],
      ['createdAt', '申请时间'],
      ['note', '备注'],
    ],
  },
}
const moneyKeys = ['price', 'rebate', 'amount', 'paidAmount', 'commission', 'balance', 'before', 'after']
const monoKeys = ['id', 'externalOrderId', 'taobaoPid', 'jdPosition', 'positionId']
const PAGE_SIZE = 10

/** 单元格渲染（列表与详情共用） */
function cell(kind: RecordKind, key: string, r: Row) {
  const v = r[key]
  // 订单状态显示联盟原始状态名（如「无效-取消」），配色按换算后的状态
  if (key === 'status') {
    const chip = <StatusChip value={String(v)} text={kind === 'orders' && r.rawStatusText ? String(r.rawStatusText) : null} />
    // 有退货时标出退货数量（全部退货的订单佣金为 0、不结算）
    if (kind !== 'orders' || !Number(r.returned)) return chip
    return (
      <div className="order-status">
        {chip}
        <small className="cell-sub">{Number(r.returned) >= Number(r.quantity) ? '已全部退货' : `退货 ${r.returned} / ${r.quantity} 件`}</small>
      </div>
    )
  }
  if (key === 'platform') return <PlatformTag platform={String(v ?? '')} />
  // 订单时间合并为一列：下单 / 完成 / 结算（结算未到时显示联盟给出的预计结算日期）
  if (key === 'times') {
    const settle = r.settledAt ? String(r.settledAt) : r.expectedSettleAt ? `预计 ${r.expectedSettleAt}` : '—'
    return (
      <dl className="order-times">
        <dt>下单</dt>
        <dd>{String(r.createdAt ?? '—')}</dd>
        <dt>完成</dt>
        <dd>{r.completedAt ? String(r.completedAt) : '—'}</dd>
        <dt>结算</dt>
        <dd className={r.settledAt ? 'is-settled' : undefined}>{settle}</dd>
      </dl>
    )
  }
  // 佣金：完成后为实际佣金，与预估不同时（如退货）附上预估佣金
  if (kind === 'orders' && key === 'commission') {
    const changed = r.estimateCommission != null && r.estimateCommission !== v && r.status === 'COMPLETED'
    return (
      <div>
        <span className="text-amount">{amount(v)}</span>
        {changed && <small className="cell-sub">预估 {amount(r.estimateCommission)}</small>}
      </div>
    )
  }
  if (key === 'settlement') {
    const [tone, text] = (({ SETTLED: ['success', '已结算'], INVALID: ['secondary', '已失效'] }) as Record<string, ['success' | 'secondary', string]>)[String(v)] || ['warning', '未结算']
    return <Chip tone={tone} dot>{text}</Chip>
  }
  if (moneyKeys.includes(key)) return key === 'paidAmount' && v == null ? null : <span className="text-amount">{amount(v)}</span>
  if (key === 'product')
    // 订单已按平台分子菜单，列表不再显示平台角标
    return kind === 'orders' ? <ProductCell row={r} sub={`订单 ${r.externalOrderId}`} /> : <ProductCell row={r} sub={String(r.category || '')} />
  if (key === 'name')
    return (
      <div className="cell-media">
        <Avatar text={String(v).slice(-2)} size="sm" round />
        <div>
          <strong>{String(v)}</strong>
          {r.externalId && String(r.externalId).toLowerCase() !== String(v).toLowerCase() && <small>{String(r.externalId)}</small>}
        </div>
      </div>
    )
  if (key === 'ratio') return v == null ? '待确认' : <span title={String(r.ratioNote || '')}>{String(v)}%</span>
  // 订单的返现用户：标出归属方式，人工关联及旧版本按商品匹配的关联便于核对
  if (kind === 'orders' && key === 'user' && r.userId && r.attribution && !['联盟标识', '已关联'].includes(String(r.attribution)))
    return (
      <div>
        {String(v)}
        <small className="cell-sub">{String(r.attribution)}</small>
      </div>
    )
  if (v == null || v === '')
    return (
      <span className="text-faint">
        {key === 'taobaoPid' || key === 'jdPosition'
          ? '未绑定'
          : key === 'settledAt' && r.settlement === 'PENDING'
          ? '未结算'
          : key === 'completedAt' && r.status !== 'CANCELLED' && r.status !== 'INVALID'
            ? // 淘宝订单接口不返回确认收货时间
              r.platform === '淘宝' ? '未获取' : '未完成'
            : '—'}
      </span>
    )
  return <span className={monoKeys.includes(key) ? 'text-mono' : key.endsWith('At') ? 'nowrap text-muted' : undefined}>{String(v)}</span>
}

type SyncState = {
  id: string
  status: string
  count: number
  windows: number
  total: number
  error: string | null
  auto?: boolean
  lastSyncedAt?: string | null
} | null

const syncRanges: [string, string][] = [
  ['1', '最近 1 小时'],
  ['24', '最近 24 小时'],
  ['168', '最近 7 天'],
  ['720', '最近 30 天'],
  ['2160', '最近 90 天'],
]

/** 距今多久：12 秒前 / 5 分钟前 / 2 小时前 */
function ago(at?: string | null) {
  if (!at) return ''
  const s = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000))
  return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.floor(s / 60)} 分钟前` : `${Math.floor(s / 3600)} 小时前`
}

/** platform：订单管理按平台拆成子菜单（京东订单 / 淘宝订单），列表、同步与同步状态都只针对该平台 */
export function Records({ kind, notify, platform }: { kind: RecordKind; notify: Notify; platform?: 'jd' | 'taobao' }) {
  const allColumns = config[kind].columns
  const qs = kind === 'orders' && platform ? `?platform=${platform}` : ''
  const listUrl = `/${kind}${qs}`
  const columns = allColumns.filter((c) => !c[2])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Row | null>(null)
  const [sync, setSync] = useState<SyncState>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await api<Row[]>(listUrl))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [listUrl])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => setPage(1), [query, status, date])

  // 订单页：轮询后台同步任务，完成后刷新列表
  useEffect(() => {
    if (kind !== 'orders') return
    let alive = true
    let seen = ''
    const poll = async () => {
      try {
        const job = await api<SyncState>(`/orders/sync-status${qs}`)
        if (!alive) return
        setSync(job)
        // 同步过程中导入了新订单或任务完成时，立即刷新列表
        const mark = job ? `${job.id}:${job.count}:${job.status}` : ''
        if (job && mark !== seen && (job.count > 0 || job.status === 'COMPLETED')) {
          if (seen) setRows(await api<Row[]>(listUrl))
        }
        seen = mark
      } catch {
        /* 轮询失败不打断页面 */
      }
    }
    void poll()
    const timer = setInterval(poll, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [kind, qs, listUrl])

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!status || r.status === status) &&
          (!date || String(r.createdAt).startsWith(date)) &&
          // 用户管理只按用户名检索
          (kind === 'users' ? String(r.name ?? '') : Object.values(r).join(' ')).toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [rows, status, date, query, kind],
  )
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const statuses = Array.from(new Set(rows.map((r) => String(r.status)).filter((s) => s && s !== 'undefined')))

  async function startSync(hours = '1') {
    setSyncing(true)
    try {
      const r = await api<{ message: string }>('/orders/sync', { method: 'POST', body: JSON.stringify({ platform, hours: Number(hours) }) })
      setSync(await api<SyncState>(`/orders/sync-status${qs}`))
      notify(r.message)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSyncing(false)
    }
  }
  const filtering = !!(query || status || date)
  const reset = () => {
    setQuery('')
    setStatus('')
    setDate('')
  }

  const sum = (s: string) => money(rows.filter((r) => r.status === s).reduce((a, r) => a + Number(r.amount), 0))
  return (
    <div className="list-page">
      {kind === 'withdrawals' && (
        <div className="stat-grid stat-grid-3">
          <StatCard icon={Clock3} tone="warning" label="待审核金额" value={sum('PENDING_REVIEW')} />
          <StatCard icon={Banknote} tone="info" label="待人工打款" value={sum('PENDING_PAYMENT')} />
          <StatCard icon={CircleCheck} tone="success" label="已完成提现" value={sum('COMPLETED')} />
        </div>
      )}
      {kind === 'orders' && sync?.status && (sync.status === 'FAILED' || (!sync.auto && sync.status !== 'COMPLETED')) && (
        <Alert tone={sync.status === 'FAILED' ? 'error' : 'info'}>
          {sync.status === 'FAILED' ? '同步失败' : '后台同步中'} · 已处理 {sync.windows}/{sync.total} 个时段 · {sync.count} 条订单
          {sync.error && ` · ${sync.error}`}
        </Alert>
      )}

      <Card className="list-card">
        <div className="toolbar">
          <TextField dense icon={Search} placeholder={kind === 'users' ? '搜索用户名' : '搜索商品、用户或编号'} aria-label="搜索" value={query} onChange={(e) => setQuery(e.target.value)} className="toolbar-search" />
          {kind !== 'rebates' && kind !== 'users' && (
            <Select dense aria-label="状态" value={status} onChange={setStatus} options={[['', '全部状态'], ...statuses.map((s): [string, string] => [s, statusLabel(s)])]} />
          )}
          {kind !== 'users' && <DatePicker dense aria-label="日期" value={date} onChange={setDate} />}
          {filtering && <IconButton icon={X} label="清除筛选" onClick={reset} />}
          {kind === 'orders' && (
            <>
              {sync?.lastSyncedAt && (
                <span className="sync-hint" title="系统会根据转链活跃度自动同步订单">
                  <CircleCheck size={14} />
                  {ago(sync.lastSyncedAt)}同步
                </span>
              )}
              <SplitButton icon={RefreshCw} loading={syncing} onClick={() => void startSync()} options={syncRanges} onSelect={(h) => void startSync(h)} menuLabel="选择同步范围">
                同步订单
              </SplitButton>
            </>
          )}
        </div>
        {error && (
          <div className="toolbar">
            <Alert tone="error" retry={load}>
              {error}
            </Alert>
          </div>
        )}
        <CardBody flush>
          {loading ? (
            <Loading />
          ) : filtered.length ? (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {columns.map(([key, label]) => (
                        <th key={key}>{label}</th>
                      ))}
                      {kind === 'withdrawals' && <th aria-label="操作" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map((r) => (
                      <tr key={r.id} className="is-clickable" onClick={() => setSelected(r)}>
                        {columns.map(([key]) => (
                          <td key={key}>{cell(kind, key, r)}</td>
                        ))}
                        {kind === 'withdrawals' && (
                          <td className="nowrap">
                            <Button variant="text" size="sm">
                              {r.status === 'PENDING_REVIEW' ? '审核' : '查看'}
                              <ChevronRight size={14} />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={current} pages={pages} total={filtered.length} onChange={setPage} />
            </>
          ) : (
            <EmptyState
              icon={Search}
              title={rows.length ? '没有符合条件的记录' : '暂无数据'}
              description={rows.length ? '换个关键词或清除筛选条件' : '收到平台数据后会显示在这里'}
              action={
                rows.length ? (
                  <Button variant="tonal" onClick={reset}>
                    清除筛选
                  </Button>
                ) : undefined
              }
            />
          )}
        </CardBody>
      </Card>

      {selected && (
        <RecordDetail
          kind={kind}
          row={selected}
          columns={allColumns.filter((c) => c[0] !== 'times')}
          notify={notify}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

/** 记录详情弹窗：用户可调整比例 / 启停；提现可审核与确认打款 */
function RecordDetail({
  kind,
  row,
  columns,
  notify,
  onClose,
  onChanged,
}: {
  kind: RecordKind
  row: Row
  columns: Column[]
  notify: Notify
  onClose: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ratio, setRatio] = useState(Number(row.ratio ?? 70))
  const [note, setNote] = useState('')
  const [proof, setProof] = useState('')
  const reviewing = kind === 'withdrawals' && ['PENDING_REVIEW', 'PENDING_PAYMENT'].includes(String(row.status))
  // 订单：可手动关联返现用户
  const [owner, setOwner] = useState(String(row.userId || ''))
  const [users, setUsers] = useState<Row[]>([])
  useEffect(() => {
    if (kind === 'orders') api<Row[]>('/users').then(setUsers).catch(() => {})
  }, [kind])

  const run = async (request: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError('')
    try {
      await request()
      notify(message)
      onChanged()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const withdraw = (action: string) =>
    run(
      () => api(`/withdrawals/${row.id}/${action}`, { method: 'POST', body: JSON.stringify({ note, proof }) }),
      action === 'approve' ? '审核已通过，下一步需确认人工打款' : '状态已更新',
    )
  const patchUser = (body: object) => run(() => api(`/users/${row.id}`, { method: 'PATCH', body: JSON.stringify(body) }), '用户信息已更新')

  let footer = null
  if (kind === 'orders')
    footer = (
      <Button
        variant="primary"
        icon={Check}
        loading={busy}
        disabled={owner === String(row.userId || '')}
        onClick={() => run(() => api(`/orders/${row.id}/user`, { method: 'PATCH', body: JSON.stringify({ userId: owner || null }) }), owner ? '已关联返现用户' : '已取消关联')}
      >
        保存关联
      </Button>
    )
  else if (kind === 'users')
    footer = (
      <>
        <Button variant="danger" disabled={busy} onClick={async () => {
            const disabling = row.status === 'ACTIVE'
            if (!disabling || (await confirm({ title: '禁用账户', content: '禁用后该用户发送的链接将不再转链，可随时重新启用。', okText: '禁用', danger: true })))
              patchUser({ status: disabling ? 'DISABLED' : 'ACTIVE' })
          }}>
          {row.status === 'ACTIVE' ? '禁用账户' : '启用账户'}
        </Button>
        <Button variant="primary" icon={Check} loading={busy} onClick={() => patchUser({ ratio })}>
          保存比例
        </Button>
      </>
    )
  else if (reviewing)
    footer =
      row.status === 'PENDING_REVIEW' ? (
        <>
          <Button variant="danger" disabled={busy} onClick={async () => {
              if (await confirm({ title: '拒绝提现', content: '拒绝后该申请将关闭，请确认已填写拒绝原因。', okText: '拒绝', danger: true })) withdraw('reject')
            }}>
            拒绝
          </Button>
          <Button variant="primary" icon={Check} loading={busy} onClick={() => withdraw('approve')}>
            审核通过
          </Button>
        </>
      ) : (
        <Button variant="primary" icon={CheckCheck} loading={busy} disabled={!proof.trim()} onClick={() => withdraw('confirm-payment')}>
          确认已打款
        </Button>
      )

  return (
    <Modal
      title={kind === 'withdrawals' ? '提现申请' : kind === 'users' ? '用户详情' : '记录详情'}
      subtitle={<span className="text-mono">{row.id}</span>}
      size={kind === 'promotions' ? 'md' : 'sm'}
      dismissible={!busy}
      onClose={onClose}
      footer={footer}
    >
      <div className="stack">
        {kind === 'promotions' ? (
          row.status === 'FAILED' ? (
            <Alert tone="error">{String(row.errorCode || '转链失败')}</Alert>
          ) : (
            <ConversionCard result={row} />
          )
        ) : (
          <dl className="desc-list">
            {columns
              .filter(([key]) => !(key === 'paidAmount' && row.paidAmount == null))
              .map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{cell(kind, key, row)}</dd>
              </div>
            ))}
          </dl>
        )}
        {kind === 'orders' && (
          <Select
            label="返现用户"
            hint="联盟未回传用户标识时，可在这里手动关联；同一订单号的所有商品一起关联"
            value={owner}
            onChange={setOwner}
            options={[['', '未关联'], ...users.map((u): [string, string] => [u.id, `${u.name}${u.externalId && String(u.externalId).toLowerCase() !== String(u.name).toLowerCase() ? `（${u.externalId}）` : ''}`])]}
          />
        )}
        {kind === 'users' && (
          <TextField label="专属返现比例（%）" type="number" min={0} max={100} value={ratio} onChange={(e) => setRatio(Number(e.target.value))} />
        )}
        {reviewing && (
          <>
            <TextArea
              label={row.status === 'PENDING_REVIEW' ? '审核备注（拒绝时必填）' : '备注'}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {row.status === 'PENDING_PAYMENT' && (
              <TextField label="打款凭证编号" hint="实际打款成功后填写银行流水或凭证编号" maxLength={120} value={proof} onChange={(e) => setProof(e.target.value)} />
            )}
          </>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}
