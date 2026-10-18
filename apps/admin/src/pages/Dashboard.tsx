import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Banknote, BarChart3, Bot, ChevronRight, Clock3, Coins, ShoppingBag, ShoppingCart, Users } from 'lucide-react'
import { api, type Row } from '../lib/api'
import { amount, errorText, money } from '../lib/format'
import { PlatformLogo, PlatformTag, Alert, Avatar, Button, Card, CardBody, CardHeader, Chip, EmptyState, Segmented, StatCard, StatusChip } from '../ui'
import { ProductCell } from './shared'

type Service = { kind: string; configured: boolean; test: null | { status: string } }
const serviceInfo: Record<string, { name: string; desc: string; path: string }> = {
  jd: { name: '京东联盟', desc: '商品转链与订单同步', path: '/affiliates' },
  taobao: { name: '淘宝联盟', desc: '商品转链与淘口令', path: '/affiliates' },
  wecom: { name: '企业微信', desc: '接收消息与回复用户', path: '/channels' },
}

export function Dashboard() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<Record<string, number>>()
  const [trends, setTrends] = useState<{ date: string; count: number }[]>([])
  const [recent, setRecent] = useState<Row[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [days, setDays] = useState(7)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Service[]>('/service-status').then(setServices).catch(() => {})
  }, [])
  const load = useCallback(async () => {
    setError('')
    try {
      const [o, t, orders] = await Promise.all([
        api<Record<string, number>>('/dashboard/overview'),
        api<{ date: string; count: number }[]>(`/dashboard/trends?days=${days}`),
        api<Row[]>('/orders'),
      ])
      setOverview(o)
      setTrends(t)
      setRecent(orders.slice(0, 5))
    } catch (e) {
      setError(errorText(e))
    }
  }, [days])
  useEffect(() => {
    void load()
  }, [load])

  const total = trends.reduce((a, t) => a + t.count, 0)
  return (
    <>
      {error && <Alert tone="error" retry={load}>{error}</Alert>}
      <div className="stat-grid">
        <StatCard icon={ShoppingCart} tone="primary" label="今日订单" value={overview?.newOrders ?? '—'} unit="单" />
        <StatCard icon={Users} tone="info" label="活跃用户" value={overview?.active ?? '—'} unit="人" />
        <StatCard icon={Coins} tone="success" label="预估佣金" value={overview ? money(overview.commission) : '—'} />
        <StatCard icon={Clock3} tone="warning" label="待审核提现" value={overview?.pending ?? '—'} unit="笔" />
      </div>

      <div className="dashboard-grid">
        <Card>
          <CardHeader
            title="订单趋势"
            subtitle={`累计 ${total.toLocaleString()} 单 · 转链成功率 ${overview?.successRate ?? '—'}%`}
            actions={<Segmented items={[[7, '7 天'], [30, '30 天'], [90, '90 天']]} value={days} onChange={setDays} />}
          />
          <CardBody>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8d51f9" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#8d51f9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="rgba(128,128,160,.18)" strokeDasharray="4 4" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#8a8d93', fontSize: 12 }} minTickGap={40} dy={8} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8a8d93', fontSize: 12 }} allowDecimals={false} domain={[0, (m: number) => Math.max(5, m)]} />
                  <Tooltip contentStyle={{ border: 'none', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,.12)', fontSize: 13 }} formatter={(v) => [`${v} 单`, '订单']} />
                  <Area type="monotone" dataKey="count" stroke="#8d51f9" strokeWidth={2.5} fill="url(#trendFill)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="服务状态" />
          <CardBody className="service-list">
            {(['wecom', 'jd', 'taobao'] as const).map((kind) => {
              const s = services.find((v) => v.kind === kind)
              const ok = s?.test?.status === 'CONNECTED'
              return (
                <button key={kind} type="button" className="service-item" onClick={() => navigate(serviceInfo[kind].path)}>
                  <PlatformLogo platform={kind} />
                  <span className="service-text">
                    <strong>{serviceInfo[kind].name}</strong>
                    <small>{serviceInfo[kind].desc}</small>
                  </span>
                  <Chip tone={ok ? 'success' : s?.configured ? 'warning' : 'secondary'}>{ok ? '正常' : s?.configured ? '待验证' : '未配置'}</Chip>
                </button>
              )
            })}
            <button type="button" className="service-item" onClick={() => navigate('/withdrawals')}>
              <Avatar icon={Banknote} tone={overview?.pending ? 'warning' : 'secondary'} />
              <span className="service-text">
                <strong>提现待审核</strong>
                <small>需人工审核与打款</small>
              </span>
              <Chip tone={overview?.pending ? 'warning' : 'secondary'}>{overview?.pending ?? 0} 笔</Chip>
            </button>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="最近订单"
          actions={
            <Button variant="text" size="sm" onClick={() => navigate('/orders')}>
              全部订单 <ChevronRight size={15} />
            </Button>
          }
        />
        <CardBody flush>
          {recent.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th>来源</th>
                    <th>预计返现</th>
                    <th>状态</th>
                    <th>下单时间</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <ProductCell row={r} sub={String(r.externalOrderId || '')} />
                      </td>
                      <td>
                        <PlatformTag platform={String(r.platform || '')} />
                      </td>
                      <td className="text-amount">{amount(r.rebate)}</td>
                      <td>
                        <StatusChip value={String(r.status)} />
                      </td>
                      <td className="text-muted nowrap">{String(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={BarChart3} title="暂无订单" description="同步联盟订单后会显示在这里" />
          )}
        </CardBody>
      </Card>
    </>
  )
}
