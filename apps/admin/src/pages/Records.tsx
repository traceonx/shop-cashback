import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Banknote, Check, CheckCheck, ChevronRight, CircleCheck, Clock3, Download, Link2, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { api, saveBlob, type Row } from '../lib/api'
import { amount, errorText, money, type Notify } from '../lib/format'
import { statusLabel } from '../lib/labels'
import { Alert, Avatar, Button, Card, CardBody, CardHeader, EmptyState, IconButton, Loading, Modal, Pagination, confirm, Select, DatePicker, StatCard, StatusChip, TextArea, TextField } from '../ui'
import { Conversion, ConversionCard } from './Conversion'
import { ProductCell } from './shared'

export type RecordKind = 'orders' | 'users' | 'rebates' | 'withdrawals' | 'promotions'
type Column = [key: string, label: string]

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
      ['platform', '来源'],
      ['user', '返现用户'],
      ['attribution', '归属'],
      ['paidAmount', '付款金额'],
      ['rebate', '预计返现'],
      ['ratio', '比例'],
      ['status', '状态'],
      ['createdAt', '下单时间'],
      ['completedAt', '完成时间'],
      ['externalOrderId', '订单号'],
    ],
  },
  users: {
    title: '用户列表',
    columns: [
      ['name', '用户'],
      ['channel', '来源'],
      ['conversions', '转链次数'],
      ['orders', '订单数'],
      ['balance', '可提现余额'],
      ['ratio', '返现比例'],
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
const monoKeys = ['id', 'externalOrderId']
const PAGE_SIZE = 10

/** 单元格渲染（列表与详情共用） */
function cell(kind: RecordKind, key: string, r: Row) {
  const v = r[key]
  if (key === 'status') return <StatusChip value={String(v)} />
  if (moneyKeys.includes(key)) return key === 'paidAmount' && v == null ? <span className="text-faint">接口未提供</span> : <span className="text-amount">{amount(v)}</span>
  if (key === 'product') return <ProductCell row={r} sub={kind === 'orders' ? String(r.sku || '') : String(r.category || '')} />
  if (key === 'name')
    return (
      <div className="cell-media">
        <Avatar text={String(v).slice(-2)} size="sm" round />
        <div>
          <strong>{String(v)}</strong>
          <small>{String(r.externalId || '')}</small>
        </div>
      </div>
    )
  if (key === 'ratio') return v == null ? '待确认' : <span title={String(r.ratioNote || '')}>{String(v)}%</span>
  if (v == null || v === '') return <span className="text-faint">{key === 'completedAt' && r.status !== 'CANCELLED' ? '未完成' : '—'}</span>
  return <span className={monoKeys.includes(key) ? 'text-mono' : key.endsWith('At') ? 'nowrap text-muted' : undefined}>{String(v)}</span>
}

type SyncState = { id: string; status: string; count: number; windows: number; total: number; error: string | null } | null

export function Records({ kind, notify }: { kind: RecordKind; notify: Notify }) {
  const { title, columns } = config[kind]
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Row | null>(null)
  const [converting, setConverting] = useState(new URLSearchParams(useLocation().search).has('test'))
  const [syncHours, setSyncHours] = useState('168')
  const [sync, setSync] = useState<SyncState>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await api<Row[]>(`/${kind}`))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [kind])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => setPage(1), [query, status, date])

  // 订单页：轮询后台同步任务，完成后刷新列表
  useEffect(() => {
    if (kind !== 'orders') return
    let alive = true
    let finished = ''
    const poll = async () => {
      try {
        const job = await api<SyncState>('/orders/sync-status')
        if (!alive) return
        setSync(job)
        if (job?.status === 'COMPLETED' && finished !== job.id) {
          finished = job.id
          setRows(await api<Row[]>('/orders'))
        }
      } catch {
        /* 轮询失败不打断页面 */
      }
    }
    void poll()
    const timer = setInterval(poll, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [kind])

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!status || r.status === status) &&
          (!date || String(r.createdAt).startsWith(date)) &&
          Object.values(r).join(' ').toLowerCase().includes(query.toLowerCase()),
      ),
    [rows, status, date, query],
  )
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const statuses = Array.from(new Set(rows.map((r) => String(r.status)).filter((s) => s && s !== 'undefined')))

  async function startSync() {
    setSyncing(true)
    try {
      const r = await api<{ message: string }>('/orders/sync', { method: 'POST', body: JSON.stringify({ platform: 'jd', hours: Number(syncHours) }) })
      setSync(await api<SyncState>('/orders/sync-status'))
      notify(r.message)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSyncing(false)
    }
  }
  function exportCsv() {
    const esc = (s: unknown) => `"${String(s ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`
    const csv = '﻿' + [columns.map((c) => c[1]).join(','), ...filtered.map((r) => columns.map(([k]) => esc(r[k])).join(','))].join('\r\n')
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${title}.csv`)
    notify('已导出当前筛选结果（金额单位：分）')
  }
  const reset = () => {
    setQuery('')
    setStatus('')
    setDate('')
  }

  const sum = (s: string) => money(rows.filter((r) => r.status === s).reduce((a, r) => a + Number(r.amount), 0))
  return (
    <>
      {kind === 'withdrawals' && (
        <div className="stat-grid stat-grid-3">
          <StatCard icon={Clock3} tone="warning" label="待审核金额" value={sum('PENDING_REVIEW')} />
          <StatCard icon={Banknote} tone="info" label="待人工打款" value={sum('PENDING_PAYMENT')} />
          <StatCard icon={CircleCheck} tone="success" label="已完成提现" value={sum('COMPLETED')} />
        </div>
      )}
      {kind === 'orders' && sync?.status && sync.status !== 'COMPLETED' && (
        <Alert tone={sync.status === 'FAILED' ? 'error' : 'info'}>
          {sync.status === 'FAILED' ? '同步失败' : '后台同步中'} · 已处理 {sync.windows}/{sync.total} 个时段 · {sync.count} 条订单
          {sync.error && ` · ${sync.error}`}
        </Alert>
      )}

      <Card>
        <CardHeader
          title={title}
          subtitle={
            kind === 'orders'
              ? '归属未核实的订单不会自动发放返现'
              : kind === 'withdrawals'
                ? '审核通过后需人工打款，再填写凭证完成'
                : undefined
          }
          actions={
            <>
              {kind === 'orders' && (
                <>
                  <Select
                    dense
                    aria-label="同步范围"
                    value={syncHours}
                    onChange={setSyncHours}
                    options={[
                      ['1', '最近 1 小时'],
                      ['24', '最近 1 天'],
                      ['168', '最近 7 天'],
                      ['720', '最近 30 天'],
                      ['2160', '最近 90 天'],
                    ]}
                  />
                  <Button variant="tonal" icon={RefreshCw} loading={syncing} onClick={startSync}>
                    同步订单
                  </Button>
                </>
              )}
              {(kind === 'orders' || kind === 'promotions') && (
                <Button variant="primary" icon={Link2} onClick={() => setConverting(true)}>
                  转链测试
                </Button>
              )}
              <Button variant="outlined" icon={Download} onClick={exportCsv}>
                导出
              </Button>
            </>
          }
        />
        <div className="toolbar">
          <TextField dense icon={Search} placeholder="搜索商品、用户或编号" aria-label="搜索" value={query} onChange={(e) => setQuery(e.target.value)} className="toolbar-search" />
          {kind !== 'rebates' && (
            <Select dense aria-label="状态" value={status} onChange={setStatus} options={[['', '全部状态'], ...statuses.map((s): [string, string] => [s, statusLabel(s)])]} />
          )}
          <DatePicker dense aria-label="日期" value={date} onChange={setDate} />
          <IconButton icon={RotateCcw} label="重置筛选" onClick={reset} />
          <IconButton icon={RefreshCw} label="刷新" spinning={loading} onClick={load} />
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

      {converting && (
        <Conversion
          notify={notify}
          onClose={() => {
            setConverting(false)
            void load()
          }}
        />
      )}
      {selected && (
        <RecordDetail
          kind={kind}
          row={selected}
          columns={columns}
          notify={notify}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null)
            void load()
          }}
        />
      )}
    </>
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
  if (kind === 'users')
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
            {columns.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{cell(kind, key, row)}</dd>
              </div>
            ))}
          </dl>
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
