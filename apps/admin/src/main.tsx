import React, { useState, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import {
  Gift,
  LayoutDashboard,
  Link2,
  ShoppingCart,
  Users,
  Wallet,
  Banknote,
  Bot,
  Settings,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Bell,
  Search,
  Plus,
  X,
  Check,
  CheckCheck,
  CheckCircle2,
  CircleHelp,
  LogOut,
  CalendarDays,
  RefreshCw,
  Copy,
  ExternalLink,
  Send,
  SlidersHorizontal,
  Download,
  MoreHorizontal,
  TrendingUp,
  BarChart3,
  Coins,
  Clock3,
  Zap,
  ShieldCheck,
  Building2,
  Sparkles,
  AlertCircle,
  Menu,
  Loader2,
  FileText,
  Eye,
  LockKeyhole,
  type LucideIcon,
} from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'
import { api, money, type Row } from './api'
import './styles.css'
import { WecomMenu } from './WecomMenu'

const navigation: [string, string, LucideIcon][] = [
  ['/', '数据概览', LayoutDashboard],
  ['/orders', '订单管理', ShoppingCart],
  ['/users', '用户管理', Users],
  ['/rebates', '返现流水', Wallet],
  ['/withdrawals', '提现审核', Banknote],
  ['/channels', '通知配置', Bot],
  ['/affiliates', '渠道配置', Building2],
  ['/settings', '系统设置', Settings],
]
const labels: Record<string, string> = {
  SUCCESS: '转链成功',
  FAILED: '转链失败',
  CREATED: '待付款',
  PAID: '已付款',
  SETTLED: '已结算',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  UNATTRIBUTED: '待核实归属',
  PENDING_REVIEW: '待审核',
  PENDING_PAYMENT: '待打款',
  REJECTED: '已拒绝',
  ACTIVE: '正常',
  DISABLED: '已禁用',
}
const Badge = ({ value }: { value: string }) => (
  <span
    className={`badge ${['SUCCESS', 'SETTLED', 'COMPLETED', 'ACTIVE'].includes(value) ? 'green' : ['FAILED', 'REJECTED', 'DISABLED'].includes(value) ? 'red' : value === 'CANCELLED' ? 'gray' : 'purple'}`}
  >
    <i />
    {labels[value] || value}
  </span>
)
function Art({
  kind,
  className = '',
}: {
  kind: 'wallet' | 'people' | 'coins' | 'clock' | 'gift' | 'clipboard'
  className?: string
}) {
  const id = React.useId().replace(/:/g, '')
  return (
    <svg className={`art ${className}`} viewBox="0 0 200 160" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={kind === 'coins' ? '#ffed9b' : kind === 'clock' ? '#ffdaa6' : '#e6e2ff'} />
          <stop offset="1" stopColor={kind === 'coins' ? '#ffb627' : kind === 'clock' ? '#ff914e' : '#8970f6'} />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0.8" y2="1">
          <stop stopColor={kind === 'wallet' ? '#b5dcff' : '#b4a4ff'} />
          <stop offset="1" stopColor={kind === 'wallet' ? '#5c9df1' : '#7351ec'} />
        </linearGradient>
        <filter id={`${id}s`}>
          <feDropShadow dx="0" dy="9" stdDeviation="6" floodColor="#6957bf" floodOpacity=".16" />
        </filter>
      </defs>
      <ellipse cx="110" cy="144" rx="68" ry="10" fill="#6862cc" opacity=".09" />
      <g filter={`url(#${id}s)`}>
        {kind === 'wallet' && (
          <>
            <rect x="45" y="32" width="112" height="98" rx="20" fill={`url(#${id}b)`} />
            <path d="M67 46L101 13 137 48" fill="#bee0ff" />
            <rect x="37" y="57" width="131" height="83" rx="19" fill={`url(#${id}a)`} />
            <rect x="119" y="83" width="57" height="32" rx="13" fill={`url(#${id}b)`} />
            <circle cx="136" cy="99" r="5" fill="#d8ebff" />
          </>
        )}
        {kind === 'people' && (
          <>
            <circle cx="86" cy="53" r="28" fill={`url(#${id}a)`} />
            <path d="M39 136V116a47 47 0 0194 0v20" fill={`url(#${id}a)`} />
            <circle cx="151" cy="66" r="21" fill={`url(#${id}b)`} opacity=".6" />
            <path d="M135 94q48-8 48 42h-40" fill={`url(#${id}b)`} opacity=".55" />
          </>
        )}
        {kind === 'coins' && (
          <>
            {[0, 1, 2, 3].map((i) => (
              <g key={i}>
                <path d={`M105 ${116 - i * 22}v17c0 17 66 17 66 0v-17`} fill="#ffb62c" />
                <ellipse
                  cx="138"
                  cy={116 - i * 22}
                  rx="33"
                  ry="12"
                  fill={`url(#${id}a)`}
                  stroke="#ffe89a"
                  strokeWidth="3"
                />
              </g>
            ))}
            {[0, 1].map((i) => (
              <g key={i}>
                <path d={`M43 ${125 - i * 20}v14c0 16 65 16 65 0v-14`} fill="#ffc342" />
                <ellipse
                  cx="75"
                  cy={125 - i * 20}
                  rx="32"
                  ry="12"
                  fill={`url(#${id}a)`}
                  stroke="#ffeba7"
                  strokeWidth="3"
                />
              </g>
            ))}
          </>
        )}
        {kind === 'clock' && (
          <>
            <circle cx="79" cy="86" r="38" fill="#ffcd9e" />
            <circle cx="127" cy="92" r="48" fill={`url(#${id}a)`} stroke="#ffe4c6" strokeWidth="3" />
            <path d="M127 65v28h19" stroke="white" strokeWidth="7" strokeLinecap="round" fill="none" />
            <path d="M105 139l-7 8m51-10 7 9" stroke="#f6a16b" strokeWidth="8" strokeLinecap="round" />
          </>
        )}
        {kind === 'gift' && (
          <>
            <path d="M42 61h85l12 78H30z" fill={`url(#${id}b)`} />
            <path d="M61 67V47c0-27 36-27 36 0v20" fill="none" stroke="#ad94ff" strokeWidth="10" />
            <path d="M119 36l-8-24 23 9 16-18 10 27 24-1-12 27z" fill="#ffd27a" stroke="#ffe9a7" strokeWidth="3" />
            <g fill="#ffd37a" stroke="#ffebae" strokeWidth="2">
              <rect x="119" y="117" width="43" height="25" rx="8" />
              <ellipse cx="140" cy="117" rx="22" ry="8" />
              <rect x="152" y="103" width="33" height="39" rx="8" />
              <ellipse cx="169" cy="103" rx="17" ry="7" />
            </g>
            <path d="M22 88l5-9 4 9 10 4-10 4-4 9-5-9-9-4z" fill="#b5a3ff" />
          </>
        )}
        {kind === 'clipboard' && (
          <>
            <g transform="rotate(10 100 85)">
              <rect x="50" y="25" width="100" height="123" rx="12" fill={`url(#${id}b)`} />
              <rect x="59" y="35" width="82" height="103" rx="6" fill="#f2efff" />
              <path d="M82 20h9a12 12 0 0124 0h8v23H82z" fill="#9482fb" />
              {[65, 91, 116].map((y) => (
                <g key={y}>
                  <rect x="70" y={y - 5} width="15" height="15" rx="4" fill="#d9f5e9" />
                  <path d={`M73 ${y + 1}l4 4 8-10`} stroke="#70ccba" strokeWidth="3" fill="none" />
                  <path d={`M96 ${y + 1}h29`} stroke="#d6d0f1" strokeWidth="5" strokeLinecap="round" />
                </g>
              ))}
            </g>
            <circle cx="158" cy="126" r="28" fill="#9985fa" stroke="#c4b8ff" strokeWidth="5" />
            <circle cx="158" cy="126" r="20" fill="#eeebff" />
            <path d="M158 113v15l10 5" fill="none" stroke="#8870ec" strokeWidth="4" strokeLinecap="round" />
          </>
        )}
      </g>
    </svg>
  )
}

function App() {
  const [signed, setSigned] = useState(!!sessionStorage.getItem('rebate-token-v2'))
  const [toast, setToast] = useState(''),
    [mobile, setMobile] = useState(false),
    [notice, setNotice] = useState(false)
  const location = useLocation(),
    navigate = useNavigate()
  const notify = useCallback((message: string) => setToast(message), [])
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4500)
      return () => clearTimeout(t)
    }
  }, [toast])
  useEffect(() => {
    const handler = () => setSigned(false)
    window.addEventListener('session-expired', handler)
    return () => window.removeEventListener('session-expired', handler)
  }, [])
  useEffect(() => {
    setMobile(false)
  }, [location.pathname])
  return (
    <>
      {!signed ? (
        <Login onLogin={() => setSigned(true)} />
      ) : (
        <div className="app-shell">
          {mobile && <div className="sidebar-scrim" onClick={() => setMobile(false)} />}
          <aside className={`sidebar ${mobile ? 'open' : ''}`}>
            <a className="brand" href="/">
              <span className="brand-mark">
                <Gift size={25} />
              </span>
              <span>
                拾惠<span className="brand-caption">返利管理平台</span>
              </span>
            </a>
            <nav>
              {navigation.map(([path, label, Icon]) => (
                <NavLink key={path} to={path} end={path === '/'}>
                  <Icon size={19} strokeWidth={1.8} />
                  <span>{label}</span>
                  {path === '/withdrawals' && <span className="nav-dot" />}
                </NavLink>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="sidebar-foot">
                <span className="health-dot" /> JD Rebate <span title={`提交 ${__GIT_SHA__}`}>v{__APP_VERSION__}</span>
              </div>
            </div>
          </aside>
          <main className="main">
            <header className="topbar">
              <div className="breadcrumb">
                <button className="icon-button mobile-menu" aria-label="打开菜单" onClick={() => setMobile(true)}>
                  <Menu size={20} />
                </button>
                <span>工作空间</span>
                <ChevronRight size={13} />
                <strong>{navigation.find((n) => n[0] === location.pathname)?.[1] || '数据概览'}</strong>
              </div>
              <div className="top-actions">
                <div className="notification-wrap">
                  <button className="icon-button" aria-label="通知" onClick={() => setNotice(!notice)}>
                    <Bell size={18} />
                    <i className="bell-dot" />
                  </button>
                  {notice && (
                    <div className="notification-panel">
                      <strong>通知中心</strong>
                      <p>欢迎体验拾惠返利管理平台</p>
                      <small>数据来自数据库与已连接的平台。</small>
                      <button
                        onClick={() => {
                          setNotice(false)
                          navigate('/withdrawals')
                        }}
                      >
                        查看提现待办 <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                </div>
                <span className="top-divider" />
                <span className="avatar admin-avatar">A</span>
                <div className="admin-name">
                  超级管理员
                  
                </div>
                <button
                  className="icon-button"
                  aria-label="退出登录"
                  onClick={() => {
                    sessionStorage.removeItem('rebate-token-v2')
                    setSigned(false)
                  }}
                >
                  <LogOut size={16} />
                </button>
              </div>
            </header>
            <div className="page-content">
              <Routes>
                <Route path="/" element={<Dashboard notify={notify} />} />
                {['promotions', 'orders', 'users', 'rebates', 'withdrawals'].map((p) => (
                  <Route key={p} path={`/${p}`} element={<Records key={p} kind={p} notify={notify} />} />
                ))}
                <Route path="/channels" element={<><Integration key="wecom" kind="wecom" /><WecomMenu /></>} />
                <Route path="/affiliates" element={<AffiliateConfigurations />} />
                <Route path="/settings" element={<SystemSettings notify={notify} />} />
                <Route
                  path="*"
                  element={
                    <div className="empty-state">
                      <h2>页面不存在</h2>
                      <button className="primary" onClick={() => navigate('/')}>
                        返回概览
                      </button>
                    </div>
                  }
                />
              </Routes>

            </div>
          </main>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button className="icon-button" onClick={() => setToast('')} aria-label="关闭提示">
            <X size={15} />
          </button>
        </div>
      )}
    </>
  )
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [initialized, setInitialized] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function checkSetup() {
    setError('')
    try {
      setInitialized((await api<{ initialized: boolean }>('/auth/setup-status')).initialized)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    void checkSetup()
  }, [])
  async function login(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (initialized === null) return
      if (!initialized) {
        if (password !== confirm) throw new Error('两次输入的密码不一致')
        await api('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) })
        setInitialized(true)
      }
      const r = await api<{ token: string; role: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      sessionStorage.setItem('rebate-token-v2', r.token)
      sessionStorage.setItem('rebate-role', r.role)
      onLogin()
    } catch (e) {
      setError((e as Error).message)
      void api<{ initialized: boolean }>('/auth/setup-status')
        .then((r) => setInitialized(r.initialized))
        .catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="login-page">
      <div className="login-intro">
        <span className="brand">
          <span className="brand-mark">
            <Gift />
          </span>
          拾惠 · 返利管理
        </span>
        <h1>
          每一份好物，
          <br />
          都有值得期待的回馈。
        </h1>
        <p>
          连接电商联盟与企业微信，
          <br />
          让订单与返现管理变得简单。
        </p>
        <Art kind="gift" />
      </div>
      <form className="login-card" onSubmit={login}>
        <span className="eyebrow">WELCOME TO SHIHUI</span>
        <h2>{initialized === false ? '创建管理员账号' : '登录管理后台'}</h2>
        <p>
          {initialized === false ? '首次使用，设置用户名和密码即可开始。' : '使用管理员账号登录，管理真实业务数据。'}
        </p>
        <label className="form-field">
          用户名
          <input
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="form-field">
          密码
          <input
            type="password"
            autoComplete={initialized === false ? 'new-password' : 'current-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={128}
          />
        </label>
        {initialized === false && (
          <label className="form-field">
            确认密码
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              maxLength={128}
            />
            <small>密码不能为空，创建后可在后台修改。</small>
          </label>
        )}
        {error && <ErrorBox message={error} />}
        {initialized === null && (
          <button type="button" className="secondary" onClick={checkSetup}>
            重新检查初始化状态
          </button>
        )}
        <button className="primary login-submit" disabled={busy || initialized === null}>
          {busy ? (
            <Loader2 className="spin" size={18} />
          ) : (
            <>
              {initialized === false ? '创建账号并进入后台' : initialized === null ? '检查初始化状态…' : '登录工作台'}{' '}
              <ArrowRight size={18} />
            </>
          )}
        </button>
        <small className="login-note">
          <LockKeyhole size={13} />
          管理员身份验证 · 数据持久保存
        </small>
      </form>
    </div>
  )
}
function PageTitle({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="page-title-actions">{children}</div>
    </div>
  )
}
function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <span>{message}</span>
      {retry && <button onClick={retry}>重试</button>}
    </div>
  )
}
function Dashboard({ notify }: { notify: (s: string) => void }) {
  const [overview, setOverview] = useState<Record<string, number>>(),
    [trends, setTrends] = useState<{ date: string; count: number }[]>([]),
    [days, setDays] = useState(7),
    [error, setError] = useState(''),
    [recent, setRecent] = useState<Row[]>([]),
    [services, setServices] = useState<{ kind: string; configured: boolean; test: null | { status: string } }[]>([])
  useEffect(() => {
    api<typeof services>('/service-status')
      .then(setServices)
      .catch(() => {})
  }, [])
  const serviceLabel = (kind: string) => {
    const s = services.find((v) => v.kind === kind)
    return s?.test?.status === 'CONNECTED' ? '凭证有效' : s?.configured ? '待验证' : '待配置'
  }
  const navigate = useNavigate()
  const load = useCallback(async () => {
    setError('')
    try {
      const [o, t, p] = await Promise.all([
        api<Record<string, number>>('/dashboard/overview'),
        api<{ date: string; count: number }[]>(`/dashboard/trends?days=${days}`),
        api<Row[]>('/orders'),
      ])
      setOverview(o)
      setTrends(t)
      setRecent(p.slice(0, 4))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [days])
  useEffect(() => {
    void load()
  }, [load])
  const metrics: {
    label: string
    value: string
    unit: string
    change: string
    color: string
    icon: LucideIcon
    art: 'wallet' | 'people' | 'coins' | 'clock'
    detail: string
  }[] = [
    {
      label: '今日订单',
      value: String(overview?.newOrders ?? '—'),
      unit: '次',
      change: '今日',
      color: 'blue',
      icon: BarChart3,
      art: 'wallet',
      detail: '让每一个链接，都带来价值',
    },
    {
      label: '活跃用户',
      value: String(overview?.active ?? '—'),
      unit: '人',
      change: '今日',
      color: 'violet',
      icon: Users,
      art: 'people',
      detail: '每一份信任，都值得用心',
    },
    {
      label: '预估佣金',
      value: overview ? money(overview.commission) : '—',
      unit: '',
      change: '预估',
      color: 'mint',
      icon: Coins,
      art: 'coins',
      detail: '预估收益，最终以联盟结算为准',
    },
    {
      label: '待审核提现',
      value: String(overview?.pending ?? '—'),
      unit: '笔',
      change: '待处理',
      color: 'peach',
      icon: ShoppingCart,
      art: 'clock',
      detail: '及时处理，让回馈准时抵达',
    },
  ]
  return (
    <>
      <PageTitle title="数据概览" subtitle="每一份回馈，都看得见。实时掌握你的业务动态。">
        <span className="date-note">
          <span className="health-dot" /> 数据库实时统计
        </span>
        <label className="date-filter">
          <CalendarDays size={16} />
          <select aria-label="统计时间范围" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>最近七天</option>
            <option value={30}>最近三十天</option>
            <option value={90}>最近九十天</option>
          </select>
        </label>
      </PageTitle>
      {error && <ErrorBox message={error} retry={load} />}
      <div className="metrics-grid">
        {metrics.map((m) => (
          <section key={m.label} className={`metric ${m.color}`}>
            <div className="metric-icon">
              <m.icon size={25} strokeWidth={1.8} />
            </div>
            <div className="metric-body">
              <span className="metric-label">{m.label}</span>
              <div className="metric-number">
                {m.value}
                <small>{m.unit}</small>
              </div>
              <div className="metric-bottom">
                <span className="metric-change">
                  {m.color === 'peach' ? <Clock3 size={12} /> : <TrendingUp size={12} />} {m.change}
                </span>
                <span>{m.color === 'peach' ? '需人工审核' : '实时统计'}</span>
              </div>
            </div>
            <Art kind={m.art} />
            <div className="metric-wave" />
          </section>
        ))}
      </div>
      <section className="panel chart-panel">
        <div className="section-header">
          <div className="section-heading">
            <span className="section-icon">
              <BarChart3 size={22} />
            </span>
            <h2>订单趋势</h2>
            <span className="section-caption">每一次分享，都有回响</span>
          </div>
          <div className="segmented">
            {[7, 30, 90].map((d) => (
              <button className={days === d ? 'selected' : ''} key={d} onClick={() => setDays(d)}>
                近{d}天
              </button>
            ))}
          </div>
        </div>
        <div className="chart-meta">
          <span>
            <i /> 订单数量
          </span>
          <span>
            累计订单 <strong>{trends.reduce((a, t) => a + t.count, 0).toLocaleString()}</strong> 次{' '}
            <span className="chart-meta-divider">|</span> 链接生成成功率{' '}
            <strong>
              {overview?.successRate ?? '—'}
              <small>%</small>
            </strong>
          </span>
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trends} margin={{ top: 18, right: 22, left: -17, bottom: 0 }}>
              <defs>
                <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8c77fc" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="#8c77fc" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#eeeaf8" strokeDasharray="4 4" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#9996ac', fontSize: 12 }}
                minTickGap={45}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#9996ac', fontSize: 12 }}
                domain={[0, (max: number) => Math.max(5, max)]}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ border: 'none', borderRadius: 12, boxShadow: '0 5px 30px #6b56b122', fontSize: 13 }}
                formatter={(v) => [`${v} 次`, '订单数量']}
              />
              <Area
                type="linear"
                dataKey="count"
                stroke="#8266f7"
                fill="url(#chartFill)"
                strokeWidth={2.6}
                dot={days === 7 ? { r: 4.5, fill: '#8266f7', stroke: 'white', strokeWidth: 2.5 } : false}
                activeDot={{ r: 6, stroke: 'white', strokeWidth: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-foot">
          <span>
            统计时间：{trends[0]?.date || '—'} — {trends.at(-1)?.date || '—'}（北京时间）
          </span>
          <span>
            仅统计已同步的真实订单 <CircleHelp size={12} />
          </span>
        </div>
      </section>
      <div className="dashboard-bottom">
        <section className="panel todo-panel">
          <div className="section-header">
            <div className="section-heading">
              <span className="section-icon">
                <Zap size={21} />
              </span>
              <h2>待办事项</h2>
              <span className="count-pill">
                {Number((overview?.pending || 0) > 0) + services.filter((s) => !s.configured).length}
              </span>
            </div>
            <button className="text-button" onClick={() => navigate('/withdrawals')}>
              查看全部 <ChevronRight size={14} />
            </button>
          </div>
          <div className="todo-content">
            <div className="todo-list">
              <button onClick={() => navigate('/withdrawals')}>
                <span className="todo-icon">
                  <Banknote size={20} />
                </span>
                <span>
                  <strong>提现申请待审核</strong>
                  <small>及时审核用户的返现申请</small>
                </span>
                <span className="todo-count">{overview?.pending ?? '—'} 笔</span>
                <ChevronRight size={16} />
              </button>
              <button onClick={() => navigate('/channels')}>
                <span className="todo-icon">
                  <Building2 size={20} />
                </span>
                <span>
                  <strong>配置企业微信接入</strong>
                  <small>连接你的第一位返利用户</small>
                </span>
                <span className="todo-pending">{serviceLabel('wecom')}</span>
                <ChevronRight size={16} />
              </button>
            </div>
            <Art kind="clipboard" />
          </div>
        </section>
        <section className="panel connection-panel">
          <div className="section-header">
            <div className="section-heading">
              <span className="section-icon">
                <ShieldCheck size={20} />
              </span>
              <h2>服务状态</h2>
            </div>
            <span className="subtle-tag">2 项服务</span>
          </div>
          <button className="service-row" onClick={() => navigate('/affiliates')}>
            <span className="service-logo jd">JD</span>
            <div>
              <strong>京东联盟</strong>
              <small>商品转链与订单同步</small>
            </div>
            <span className="status-neutral">{serviceLabel('jd')}</span>
            <ChevronRight size={14} />
          </button>
          <button className="service-row" onClick={() => navigate('/channels')}>
            <span className="service-logo wecom">
              <Bot size={23} />
            </span>
            <div>
              <strong>企业微信</strong>
              <small>消息触达与用户连接</small>
            </div>
            <span className="status-neutral">{serviceLabel('wecom')}</span>
            <ChevronRight size={14} />
          </button>
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="section-header">
          <div className="section-heading">
            <span className="section-icon">
              <Link2 size={20} />
            </span>
            <h2>最近订单</h2>
            <span className="section-caption">好物分享的最新动态</span>
          </div>
          <button className="text-button" onClick={() => navigate('/orders')}>
            全部记录 <ArrowRight size={14} />
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>商品信息</th>
                <th>来源</th>
                <th>预计返现</th>
                <th>订单状态</th>
                <th>下单时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <div className="product-cell">
                      <ProductIcon imageUrl={typeof r.imageUrl === 'string' ? r.imageUrl : undefined} />
                      <div>
                        <strong>{String(r.product)}</strong>
                        <small>{String(r.externalOrderId || '')}</small>
                      </div>
                    </div>
                  </td>
                  <td>{String(r.platform || '—')}</td>
                  <td className="amount">{amount(r.rebate)}</td>
                  <td>
                    <Badge value={String(r.status)} />
                  </td>
                  <td className="muted">{String(r.createdAt)}</td>
                  <td>
                    <button className="icon-button" aria-label="查看订单记录" onClick={() => navigate('/orders')}>
                      <ArrowUpRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
function ProductIcon({ large = false, imageUrl }: { index?: number; large?: boolean; imageUrl?: string }) {
  return (
    <div className={'product-thumb ' + (large ? 'large' : '')}>
      {imageUrl ? (
        <img src={imageUrl} alt="商品" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <ShoppingCart size={large ? 45 : 21} />
      )}
    </div>
  )
}
function amount(value: Row[string] | undefined) {
  return value == null || value === '' ? '待确认' : money(Number(value))
}

const kindInfo: Record<string, { title: string; subtitle: string; columns: [string, string][] }> = {
  promotions: {
    title: '链接操作记录',
    subtitle: '每一次好物分享，都有迹可循。',
    columns: [
      ['product', '商品信息'],
      ['user', '用户'],
      ['price', '商品售价'],
      ['rebate', '预计返现'],
      ['status', '状态'],
      ['createdAt', '下单时间'],
    ],
  },
  orders: {
    title: '订单管理',
    subtitle: '真实订单明细，来源、付款与返现进度一目了然。',
    columns: [
      ['product', '商品信息'],
      ['platform', '来源'],
      ['amount', '金额'],
      ['user', '返现用户'],
      ['attribution', '归属状态'],
      ['paidAmount', '付款金额'],
      ['rebate', '预计返现'],
      ['ratio', '返现比例'],
      ['createdAt', '下单时间'],
      ['completedAt', '完成时间'],
      ['externalOrderId', '订单号'],
      ['status', '状态'],
    ],
  },
  users: {
    title: '用户管理',
    subtitle: '连接每一位用户，让每一份信任持续生长。',
    columns: [
      ['name', '用户信息'],
      ['channel', '来源渠道'],
      ['conversions', '订单数量'],
      ['orders', '订单数量'],
      ['balance', '可提现余额'],
      ['ratio', '返现比例'],
      ['status', '账户状态'],
    ],
  },
  rebates: {
    title: '返现流水',
    subtitle: '每一分回馈都有记录，资金流转清晰可查。',
    columns: [
      ['id', '流水编号'],
      ['user', '用户'],
      ['type', '资金类型'],
      ['amount', '变动金额'],
      ['before', '变更前余额'],
      ['after', '变更后余额'],
      ['createdAt', '时间'],
    ],
  },
  withdrawals: {
    title: '提现审核',
    subtitle: '认真对待每一份回馈，审核与人工打款分步完成。',
    columns: [
      ['id', '申请编号'],
      ['user', '申请用户'],
      ['amount', '申请金额'],
      ['status', '审核状态'],
      ['createdAt', '申请时间'],
      ['note', '审核备注'],
    ],
  },
}
function Records({ kind, notify }: { kind: string; notify: (s: string) => void }) {
  useEffect(() => {
    const open = () => setConvert(true)
    window.addEventListener('open-conversion', open)
    return () => window.removeEventListener('open-conversion', open)
  }, [])
  const info = kindInfo[kind],
    [rows, setRows] = useState<Row[]>([]),
    [syncHours, setSyncHours] = useState('168'),
    [syncState, setSyncState] = useState<{
      id: string
      status: string
      count: number
      windows: number
      total: number
      error: string | null
    } | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Row | null>(null),
    [convert, setConvert] = useState(new URLSearchParams(useLocation().search).has('test')),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(''),
    [proof, setProof] = useState(''),
    [ratio, setRatio] = useState(70),
    [date, setDate] = useState(''),
    [dialogError, setDialogError] = useState('')
  useEffect(() => {
    if (kind !== 'orders') return
    let alive = true,
      previous = ''
    const poll = async () => {
      try {
        const job = await api<typeof syncState>('/orders/sync-status')
        if (!alive) return
        setSyncState(job)
        if (job && job.status === 'COMPLETED' && previous !== job.id) {
          previous = job.id
          setRows(await api<Row[]>('/orders'))
        }
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [kind])
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await api<Row[]>(`/${kind}`))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [kind])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    setPage(1)
  }, [query, status, date])
  const filtered = rows.filter(
    (r) =>
      (!status || r.status === status) &&
      (!date || String(r.createdAt).startsWith(date)) &&
      Object.values(r).join(' ').toLowerCase().includes(query.toLowerCase()),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / 8)),
    current = Math.min(page, pages)
  const open = (r: Row) => {
    setSelected(r)
    setNote('')
    setProof('')
    setRatio(Number(r.ratio ?? 70))
    setDialogError('')
  }
  const act = async (action: string) => {
    if (!selected) return
    setBusy(true)
    setDialogError('')
    try {
      await api(`/withdrawals/${selected.id}/${action}`, { method: 'POST', body: JSON.stringify({ note, proof }) })
      setSelected(null)
      notify(action === 'approve' ? '审核已通过，下一步需单独确认人工打款' : '状态已更新，操作已记录')
      await load()
    } catch (e) {
      setDialogError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const updateUser = async (disable: boolean) => {
    if (!selected) return
    setBusy(true)
    setDialogError('')
    try {
      await api(`/users/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify(disable ? { status: selected.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' } : { ratio }),
      })
      setSelected(null)
      notify('用户信息已更新')
      await load()
    } catch (e) {
      setDialogError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const exportCsv = () => {
    const escape = (s: unknown) =>
      `"${String(s ?? '')
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`
    const csv =
      '\ufeff' +
      [
        info.columns.map((c) => c[1]).join(','),
        ...filtered.map((r) => info.columns.map(([key]) => escape(r[key])).join(',')),
      ].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${info.title}-真实数据.csv`
    a.click()
    URL.revokeObjectURL(url)
    notify('已导出筛选后的数据库记录（金额单位：分）')
  }
  return (
    <>
      <PageTitle title={info.title} subtitle={info.subtitle}>
        <button className="button" onClick={exportCsv}>
          <Download size={16} />
          导出记录
        </button>
        {['orders', 'promotions'].includes(kind) && (
          <button className="primary" onClick={() => setConvert(true)}>
            <Plus size={17} />
            转链测试
          </button>
        )}
        {kind === 'orders' && (
          <select aria-label="历史订单同步范围" value={syncHours} onChange={(e) => setSyncHours(e.target.value)}>
            <option value="1">最近一小时更新</option>
            <option value="24">最近一天订单</option>
            <option value="168">最近七天订单</option>
            <option value="720">最近三十天订单</option>
            <option value="2160">最近九十天订单</option>
          </select>
        )}
        {kind === 'orders' && (
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const result = await api<{ message: string }>('/orders/sync', {
                  method: 'POST',
                  body: JSON.stringify({ platform: 'jd', hours: Number(syncHours) }),
                })
                setSyncState(await api<typeof syncState>('/orders/sync-status'))
                notify(result.message)
                await load()
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            <RefreshCw size={16} />
            同步订单
          </button>
        )}
      </PageTitle>
      {kind === 'orders' && syncState && (
        <div className="info-box" role="status">
          <RefreshCw size={18} />
          <span>
            {syncState.status === 'COMPLETED' ? '同步完成' : syncState.status === 'FAILED' ? '同步失败' : '后台同步中'}{' '}
            · 已处理 {syncState.windows}/{syncState.total} 个时段 · {syncState.count} 条订单行
            {syncState.error && (
              <>
                <br />
                {syncState.error}
              </>
            )}
            <br />
            查询联盟推广订单；归属未核实的订单不会自动发放返现。后台任务可在离开页面后继续。
          </span>
        </div>
      )}
      {kind === 'withdrawals' && (
        <div className="mini-stats">
          {[
            ['待审核金额', 'PENDING_REVIEW'],
            ['待人工打款', 'PENDING_PAYMENT'],
            ['已完成提现', 'COMPLETED'],
          ].map(([label, value]) => (
            <div className="panel" key={value}>
              <span>{label}</span>
              <strong>{money(rows.filter((r) => r.status === value).reduce((a, r) => a + Number(r.amount), 0))}</strong>
              <small>实际金额 · 人工审核流程</small>
            </div>
          ))}
        </div>
      )}
      <div className="info-strip">
        <ShieldCheck size={16} />
        {kind === 'orders'
          ? '订单归属尚未通过京东接口验证；待核实订单不会自动分配返现。'
          : kind === 'withdrawals'
            ? '审核通过后仍需人工打款，确认实际到账后再填写凭证完成申请。'
            : '列表仅展示数据库中的真实记录，尚未收到平台数据时保持为空。'}
      </div>
      <section className="panel records-panel">
        <div className="records-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="搜索记录"
              placeholder="搜索商品、用户或编号…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="icon-button" aria-label="清除搜索" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>
          <div className="filters">
            {kind !== 'rebates' && (
              <select aria-label="筛选状态" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">全部状态</option>
                {Array.from(
                  new Set([
                    ...(kind === 'orders' ? ['COMPLETED', 'CREATED', 'CANCELLED'] : []),
                    ...rows.map((r) => String(r.status)),
                  ]),
                ).map((s) => (
                  <option key={s} value={s}>
                    {labels[s] || s}
                  </option>
                ))}
              </select>
            )}
            <input type="date" aria-label="筛选日期" value={date} onChange={(e) => setDate(e.target.value)} />
            <button
              className="icon-button"
              title="重置筛选"
              aria-label="重置筛选"
              onClick={() => {
                setQuery('')
                setStatus('')
                setDate('')
              }}
            >
              <SlidersHorizontal size={18} />
            </button>
            <button className="icon-button" aria-label="刷新列表" onClick={load}>
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </div>
        {error && <ErrorBox message={error} retry={load} />}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {info.columns.map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                filtered.slice((current - 1) * 8, current * 8).map((r, i) => (
                  <tr key={r.id}>
                    {info.columns.map(([key]) => (
                      <td key={key}>
                        {key === 'status' ? (
                          <Badge value={String(r[key])} />
                        ) : [
                            'price',
                            'rebate',
                            'amount',
                            'paidAmount',
                            'commissionBase',
                            'commission',
                            'balance',
                            'before',
                            'after',
                          ].includes(key) ? (
                          <span className={['rebate', 'balance', 'amount'].includes(key) ? 'amount' : ''}>
                            {key === 'paidAmount' && r[key] == null ? '接口未提供' : amount(r[key])}
                          </span>
                        ) : key === 'product' ? (
                          <div className="product-cell">
                            <ProductIcon imageUrl={typeof r.imageUrl === 'string' ? r.imageUrl : undefined} />
                            <div>
                              <strong>{String(r[key])}</strong>
                              <small>{kind === 'orders' ? String(r.sku || '') : String(r.category || '')}</small>
                            </div>
                          </div>
                        ) : key === 'name' ? (
                          <div className="user-cell">
                            <span className="avatar">{String(r[key]).slice(-2)}</span>
                            <div>
                              <strong>{String(r[key])}</strong>
                              <small>{String(r.externalId)}</small>
                            </div>
                          </div>
                        ) : key === 'ratio' ? (
                          r[key] == null ? (
                            '待确认'
                          ) : (
                            <span title={String(r.ratioNote || '')}>
                              {r[key]}%
                              {kind === 'orders' && String(r.ratioNote).includes('当前') && <small>（当前规则）</small>}
                            </span>
                          )
                        ) : (
                          <span
                            className={
                              ['id', 'externalOrderId', 'createdAt', 'completedAt'].includes(key) ? 'muted numeric' : ''
                            }
                          >
                            {r[key] == null
                              ? ['completedAt'].includes(key)
                                ? r.status === 'CANCELLED'
                                  ? '—'
                                  : '未完成'
                                : '—'
                              : String(r[key])}
                          </span>
                        )}
                      </td>
                    ))}
                    <td>
                      <button className="text-button" onClick={() => open(r)}>
                        {kind === 'withdrawals' && r.status === 'PENDING_REVIEW' ? '审核' : '详情'}
                        <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {loading ? (
          <div className="empty-state">
            <Loader2 className="spin" size={26} />
            <p>正在加载记录…</p>
          </div>
        ) : (
          !filtered.length && (
            <div className="empty-state">
              <Search size={30} />
              <h3>没有找到符合条件的记录</h3>
              <p>试试其他关键词，或清除筛选条件。</p>
              <button
                className="button"
                onClick={() => {
                  setQuery('')
                  setStatus('')
                  setDate('')
                }}
              >
                清除筛选
              </button>
            </div>
          )
        )}
        <div className="pagination">
          <span>
            共 <strong>{filtered.length}</strong> 条记录 <small>每页 8 条</small>
          </span>
          <div>
            <button disabled={current === 1} onClick={() => setPage(current - 1)}>
              上一页
            </button>
            {Array.from({ length: pages }, (_, i) => (
              <button className={current === i + 1 ? 'active' : ''} key={i} onClick={() => setPage(i + 1)}>
                {i + 1}
              </button>
            ))}
            <button disabled={current === pages} onClick={() => setPage(current + 1)}>
              下一页
            </button>
          </div>
        </div>
      </section>
      {convert && (
        <Conversion
          onClose={() => {
            setConvert(false)
            void load()
          }}
          notify={notify}
        />
      )}
      {selected && (
        <Modal
          title={kind === 'withdrawals' ? '提现申请详情' : kind === 'users' ? '用户详情' : '记录详情'}
          onClose={() => !busy && setSelected(null)}
        >
          <div className="detail-id">
            {selected.id}
            <span className="subtle-tag">数据库记录</span>
          </div>
          {kind === 'promotions' ? (
            selected.status === 'FAILED' ? (
              <ErrorBox message="商品链接生成失败，请检查平台权限或查看错误信息。" />
            ) : (
              <ChatCard result={selected} />
            )
          ) : (
            <dl className="detail-list">
              {info.columns.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {key === 'status' ? (
                      <Badge value={String(selected[key])} />
                    ) : ['amount', 'paidAmount', 'rebate', 'commission', 'balance', 'before', 'after'].includes(key) ? (
                      amount(selected[key])
                    ) : (
                      String(selected[key] || '—')
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {kind === 'users' && (
            <>
              <label className="form-field">
                专属返现比例（%）
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={ratio}
                  onChange={(e) => setRatio(Number(e.target.value))}
                />
              </label>
              <div className="dialog-actions">
                <button className="button danger" disabled={busy} onClick={() => updateUser(true)}>
                  {selected.status === 'ACTIVE' ? '禁用账户' : '启用账户'}
                </button>
                <button className="primary" disabled={busy} onClick={() => updateUser(false)}>
                  保存比例
                </button>
              </div>
            </>
          )}
          {kind === 'orders' && (
            <div className="info-box">
              <Clock3 size={19} />
              <span>所有金额与状态以平台返回为准。未核实归属的订单不会自动分配返现。</span>
            </div>
          )}
          {kind === 'withdrawals' && ['PENDING_REVIEW', 'PENDING_PAYMENT'].includes(String(selected.status)) && (
            <>
              <label className="form-field">
                审核备注{selected.status === 'PENDING_REVIEW' ? '（拒绝时必填）' : ''}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="请填写审核原因或备注"
                  maxLength={500}
                />
              </label>
              {selected.status === 'PENDING_PAYMENT' && (
                <label className="form-field">
                  人工打款凭证编号（必填）
                  <input
                    value={proof}
                    onChange={(e) => setProof(e.target.value)}
                    placeholder="填写实际人工打款的银行流水或凭证编号"
                    maxLength={120}
                  />
                </label>
              )}
              <div className="info-box">
                <ShieldCheck size={18} />
                <span>
                  {selected.status === 'PENDING_REVIEW'
                    ? '确认通过后，申请将进入待打款状态；不会直接标记为已完成。'
                    : '仅在实际打款成功后确认，提交后将扣减冻结余额并记录资金流水。'}
                </span>
              </div>
              <div className="dialog-actions">
                {selected.status === 'PENDING_REVIEW' ? (
                  <>
                    <button className="button danger" disabled={busy} onClick={() => act('reject')}>
                      拒绝申请
                    </button>
                    <button className="primary" disabled={busy} onClick={() => act('approve')}>
                      <Check size={16} />
                      确认审核通过
                    </button>
                  </>
                ) : (
                  <button className="primary" disabled={busy} onClick={() => act('confirm-payment')}>
                    <CheckCheck size={16} />
                    确认人工打款完成
                  </button>
                )}
              </div>
            </>
          )}
          {dialogError && <ErrorBox message={dialogError} />}
        </Modal>
      )}
    </>
  )
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  const panel = React.useRef<HTMLDivElement>(null)
  const closeRef = React.useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
      if (e.key === 'Tab') {
        const els = panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,select,[tabindex="0"]',
        )
        if (!els?.length) return
        const first = els[0],
          last = els[els.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', key)
    return () => {
      document.body.style.overflow = before
      window.removeEventListener('keydown', key)
      previous?.focus()
    }
  }, [])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">SHIHUI WORKSPACE</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
function ChatCard({ result }: { result: Row }) {
  return (
    <div className="chat-product">
      <div className="conversion-success">
        <CheckCircle2 size={16} />
        商品链接已生成
      </div>
      {result.infoMessage && (
        <div className="info-box" role="status">
          {String(result.infoMessage)}
        </div>
      )}
      <ProductIcon large imageUrl={typeof result.imageUrl === 'string' ? result.imageUrl : undefined} />
      <h3>{String(result.product)}</h3>
      <div className="chat-prices">
        <div>
          <span>商品售价</span>
          <strong>{amount(result.price)}</strong>
        </div>
        <div>
          <span>可用优惠券</span>
          <strong>{result.coupon == null ? '暂无可确认优惠券' : amount(result.coupon)}</strong>
        </div>
        <div>
          <span>预计返现</span>
          <strong>{amount(result.rebate)}</strong>
        </div>
      </div>
      <div className="final-price">
        <span>预计最终到手价</span>
        <strong>{amount(result.finalPrice)}</strong>
      </div>
      <div className="promotion-link">
        <span>推广链接：</span>
        <a href={String(result.promotionUrl)} target="_blank" rel="noopener noreferrer">
          {String(result.promotionUrl)}
        </a>
        <ExternalLink size={12} />
      </div>
      <p className="price-note">价格、优惠券及返现以实际下单和结算结果为准。未核实的数据不计入预计收益。</p>
    </div>
  )
}

function Conversion({ onClose, notify }: { onClose: () => void; notify: (s: string) => void }) {
  const [content, setContent] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<Row>()
  const run = async () => {
    setBusy(true)
    setError('')
    setResult(undefined)
    try {
      setResult(await api<Row>('/promotions/convert', { method: 'POST', body: JSON.stringify({ content }) }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="智能转链测试" onClose={onClose} wide>
      <div className="conversion-layout">
        <div className="conversion-form">
          <span className="subtle-tag">
            <Sparkles size={13} /> 京东联盟 · 实时接口
          </span>
          <h3>好物链接，一键生成回馈</h3>
          <p>粘贴京东商品链接或分享文案，预览用户在企业微信中收到的转链消息。</p>
          <label className="form-field">
            商品链接或分享文案
            <textarea
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="粘贴 https://item.jd.com/… 或京东分享文案"
              rows={5}
              maxLength={3000}
            />
          </label>

          <button className="primary convert-submit" disabled={busy || !content.trim()} onClick={run}>
            {busy ? <Loader2 className="spin" size={17} /> : <Zap size={17} />}{' '}
            {busy ? '正在请求京东…' : '生成推广链接'}
          </button>
          {error && <ErrorBox message={error} />}
          <div className="info-box">
            <CircleHelp size={18} />
            <span>将调用后台已配置的京东联盟接口。未确认优惠券、佣金与用户归属时，返现显示待确认。</span>
          </div>
          {result && (
            <button
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${result.product}\n商品售价：${amount(result.price)}\n预计返现：${amount(result.rebate)}\n推广链接：${result.promotionUrl}`,
                  )
                  notify('商品消息已复制')
                } catch {
                  setError('复制失败，请检查浏览器剪贴板权限')
                }
              }}
            >
              <Copy size={15} />
              复制商品消息
            </button>
          )}
        </div>
        <div className="chat-preview">
          <div className="chat-heading">
            <Bot size={18} />
            <span>企业微信 · 返利助手</span>
            <span className="preview-tag">消息预览</span>
          </div>
          <div className="chat-scroll">
            {result ? (
              <>
                <div className="user-message">{content}</div>
                <div className="bot-message">
                  <span className="bot-avatar">
                    <Bot size={16} />
                  </span>
                  <ChatCard result={result} />
                </div>
              </>
            ) : (
              <div className="chat-empty">
                <span>
                  <Link2 size={32} />
                </span>
                <h3>下一份惊喜，从一个链接开始</h3>
                <p>在左侧输入链接，即可预览转链消息</p>
              </div>
            )}
          </div>
          <div className="chat-input">
            <span>发送商品链接，发现更多回馈</span>
            <Send size={15} />
          </div>
        </div>
      </div>
    </Modal>
  )
}
type IntegrationData = {
  kind: string
  configured: boolean
  fields: { key: string; label: string; secret: boolean; value: string; configured: boolean }[]
  test: null | { status: string; message: string; checkedAt: string }
  callbackPath: string
}
function AffiliateConfigurations() {
  return <><PageTitle title="渠道配置" subtitle="点击卡片查看和编辑配置。" /><div className="affiliate-card-list"><Integration kind="jd" compact /><Integration kind="taobao" compact /></div></>
}
function Integration({ kind, compact = false }: { kind: 'wecom' | 'jd' | 'taobao'; compact?: boolean }) {
  const platformName = kind === 'jd' ? '京东联盟' : kind === 'taobao' ? '淘宝联盟' : '企业微信自建应用'
  const platformLogo = kind === 'jd' ? 'JD' : kind === 'taobao' ? '淘' : <Bot size={30} />

  const [opened, setOpened] = useState(false)
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  async function openDetails() {
    setOpened(true)
    setLoading(true)
    setError('')
    try {
      const d = await api<IntegrationData>('/integrations/' + kind + '/details', { method: 'POST' })
      setData(d)
      setValues(Object.fromEntries(d.fields.map((f) => [f.key, f.value])))
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }
  function closeDetails() {
    if (busy) return
    setOpened(false)
    setVisible({})
    setValues({})
    void load()
  }
  const [data, setData] = useState<IntegrationData>(),
    [values, setValues] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await api<IntegrationData>('/integrations/' + kind)
      setData(d)
      setValues(Object.fromEntries(d.fields.map((f) => [f.key, f.value])))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [kind])
  useEffect(() => {
    void load()
  }, [load])
  const configStatus = kind === 'taobao' ? (data?.configured ? '已配置 · 待接入' : '待配置 · 待接入') : data?.test?.status === 'CONNECTED' ? '连接测试通过' : data?.configured ? '待验证' : '待配置'
  const dirty = !!data && data.fields.some((f) => values[f.key] !== f.value)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNotice('')
    setError('')
    try {
      const d = await api<IntegrationData>('/integrations/' + kind, { method: 'PUT', body: JSON.stringify(values) })
      setData(d)
      setValues(Object.fromEntries(d.fields.map((f) => [f.key, f.value])))
      await openDetails()
      setNotice('配置已保存。')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function test() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api<NonNullable<IntegrationData['test']>>('/integrations/' + kind + '/test', {
        method: 'POST',
      })
      setData((d) => (d ? { ...d, test: result } : d))
      if (result.status === 'CONNECTED') setNotice(result.message)
      else setError(result.message)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {!compact && <PageTitle title="通知配置" subtitle="点击卡片查看和编辑配置。" />}
      {!opened && error && <ErrorBox message={error} />}
      <div className="provider-cards">
        <button className={'provider-tile ' + kind} onClick={openDetails} disabled={loading}>
          <span className="provider-tile-top"><span className={'provider-dot ' + (data?.test?.status === 'CONNECTED' ? 'connected' : '')} />{kind === 'wecom' ? '通知1' : platformName}<ChevronRight size={18} /></span>
          <span className="provider-tile-bottom"><span>{kind === 'wecom' ? '企业微信' : platformName}<small>{loading ? '读取中' : configStatus}</small></span><span className={'service-logo ' + kind}>{platformLogo}</span></span>
          <span className="provider-tile-link">配置详情</span>
        </button>
      </div>
      {opened && <Modal title="配置详情" onClose={closeDetails} wide>
      <div className="integration-grid">
        <form className="panel integration-card" onSubmit={save}>
          <div className="integration-header">
            <span className={'service-logo ' + kind}>
              {platformLogo}
            </span>
            <div>
              <h2>{platformName}</h2>
              <p>{kind === 'jd' ? 'JINGDONG AFFILIATE' : kind === 'taobao' ? 'TAOBAO AFFILIATE' : 'WECOM APPLICATION'}</p>
            </div>
            <span className={'badge integration-status ' + (data?.test?.status === 'CONNECTED' ? 'connected' : 'pending')}>
              {configStatus}
            </span>
          </div>
          <div className="info-box">
            <ShieldCheck size={19} />
            <span>配置加密保存。密钥默认隐藏，点击“显示”可查看已保存内容。</span>
          </div>
          {error && <ErrorBox message={error} />}{' '}
          {notice && (
            <div className="save-success" role="status">
              <CheckCircle2 size={17} />
              {notice}
            </div>
          )}
          {loading ? (
            <div className="empty-state">
              <Loader2 className="spin" />
              正在读取配置
            </div>
          ) : (
            data && (
              <>
                <div className="integration-fields">
                  {(kind === 'jd' ? [
                    { title: '应用凭证', keys: ['appKey', 'appSecret'] },
                    { title: '推广标识', keys: ['unionId', 'positionId', 'siteId'] },
                  ] : kind === 'taobao' ? [
                    { title: '应用凭证', keys: ['appKey', 'appSecret'] },
                    { title: '推广标识', keys: ['pid', 'adzoneId'] },
                  ] : [
                    { title: '应用凭证', keys: ['corpId', 'agentId', 'secret'] },
                    { title: '通知与回调', keys: ['token', 'aesKey', 'adminUserId'] },
                  ]).map((group) => <section className="integration-field-group" key={group.title}>
                    <h3>{group.title}</h3>
                    <div className="integration-group-fields">
                  {group.keys.map((key) => data.fields.find((field) => field.key === key)).filter((f): f is IntegrationData['fields'][number] => !!f).map((f) => (
                    <label className={"form-field " + (kind === "jd" && ["unionId", "positionId"].includes(f.key) ? "half" : "")} key={f.key}>
                      <span className="integration-field-label">{f.label}</span>
                      {f.secret && <button type="button" className="secret-toggle" onClick={() => setVisible({ ...visible, [f.key]: !visible[f.key] })}>{visible[f.key] ? "隐藏" : "显示"}</button>}
                      <input
                        type={f.secret && !visible[f.key] ? 'password' : 'text'}
                        readOnly={kind === 'taobao' && f.key === 'adzoneId'}
                        autoComplete="off"
                        spellCheck={false}
                        value={values[f.key] || ''}
                        onChange={(e) => {
                          setValues({ ...values, [f.key]: e.target.value })
                          setNotice('')
                        }}
                        placeholder={f.secret && f.configured ? '已安全保存，输入新值以替换' : '请输入 ' + f.label}
                        maxLength={2000}
                      />
                    </label>
                  ))}
                    </div>
                  </section>)}
                </div>
                {kind === 'wecom' && (
                  <div className="info-box">
                    <Link2 size={18} />
                    <span>
                      回调路径：{data.callbackPath}
                      <br />
                      在企业微信填写你的公网 HTTPS 域名 +
                      此路径。连接测试仅验证应用凭证，回调需在企业微信后台单独保存验证。
                    </span>
                  </div>
                )}
                {data.test && (
                  <p className="connection-result">
                    上次测试：{new Date(data.test.checkedAt).toLocaleString('zh-CN')}
                    <br />
                    {data.test.message}
                  </p>
                )}
                <div className="integration-footer">
                  <button className="button" type="button" disabled={kind === 'taobao' || busy || dirty || !data.configured} onClick={test}>
                    <RefreshCw size={15} />
                    {kind === 'taobao' ? '接口联调待启用' : kind === 'jd' ? '测试订单查询权限' : '测试已保存配置'}
                  </button>
                  <button className="primary" disabled={busy || !dirty}>
                    {busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />}保存配置
                  </button>
                </div>
                {dirty && <p className="muted">有未保存修改，请先保存再测试。</p>}
              </>
            )
          )}
        </form>
        <aside className="panel guide-card">
          <h2>接入说明</h2>
          {kind === 'taobao' && <><p>凭证可先保存，转链、商品查询和订单同步尚未启用。</p><a className="button" href="https://developer.alibaba.com/docs/api.htm?apiId=65409" target="_blank" rel="noopener noreferrer">淘宝联盟接口文档 <ExternalLink size={15} /></a></>}
          {kind === 'jd' && (
            <>
              <a className="button" href="https://union.jd.com/" target="_blank" rel="noopener noreferrer">
                登录京东联盟官网 <ExternalLink size={15} />
              </a>
              <p className="muted">
                此入口仅打开官网，登录不会自动授权本系统。当前插件使用应用凭证查询近 90
                天的联盟推广订单，不能读取个人购物账号的全部订单。
              </p>
              <a href="https://union.jd.com/openplatform/api/12707" target="_blank" rel="noopener noreferrer">
                查看官方订单接口文档
              </a>
            </>
          )}
          <h3 className="guide-steps-title">配置步骤</h3>
          {(kind === 'jd'
            ? [
                '使用京东联盟开发者平台创建的应用 AppKey 与 AppSecret；不收集京东登录密码。',
                'siteId 对应网站 / APP / 流量媒体标识，与推广位 ID（positionId）分开填写；填写后请点击保存配置。',
                '订单查询只需 AppKey 与 AppSecret，站点 ID 仅用于转链。',
                '订单归属未核实前，不会自动入账返现。',
              ]
            : kind === 'taobao' ? [
                '填写淘宝开放平台应用的 AppKey 与 AppSecret。',
                '填写完整 PID，保存时自动提取推广位 ID。',
                '链接和淘口令转链需核实对应场景权限。',
                '保存凭证不代表接口已开通，后续将分别验证转链、物料和订单。',
              ] : [
                '在企业微信创建自建应用并设置可见范围。',
                '填写 CorpID、AgentID 和应用 Secret。',
                '设置可信 IP，填写回调 Token 与 EncodingAESKey。',
                '回调验证通过后，向应用发送消息即可建立真实用户。',
              ]
          ).map((v, i) => (
            <div className="guide-step" key={i}>
              <span>{i + 1}</span>
              <p>{v}</p>
            </div>
          ))}
        </aside>
      </div>
      </Modal>}
    </>
  )
}
function ChangePassword({ notify }: { notify: (s: string) => void }) {
  const [currentPassword, setCurrent] = useState(''),
    [newPassword, setNew] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致')
      return
    }
    setBusy(true)
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
      notify('密码已修改，请使用新密码重新登录')
      sessionStorage.removeItem('rebate-token-v2')
      window.dispatchEvent(new Event('session-expired'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={save}>
      <h2>修改登录密码</h2>
      <p className="muted">修改成功后，所有设备上的旧登录会话将失效。</p>
      <label className="form-field">
        当前密码
        <input
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
          maxLength={256}
        />
      </label>
      <label className="form-field">
        新密码
        <input
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
          maxLength={128}
        />
      </label>
      <label className="form-field">
        确认新密码
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          maxLength={128}
        />
      </label>
      {error && <ErrorBox message={error} />}
      <button className="primary" disabled={busy}>
        {busy ? '正在保存…' : '修改密码'}
      </button>
    </form>
  )
}
function SystemSettings({ notify }: { notify: (s: string) => void }) {
  const [ratio, setRatio] = useState(70),
    [minimum, setMinimum] = useState(10),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState('rules'),
    [logs, setLogs] = useState<Row[]>([])
  useEffect(() => {
    api<{ ratio: number; minimum: number }>('/settings')
      .then((r) => {
        setRatio(r.ratio)
        setMinimum(r.minimum)
      })
      .catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    if (tab === 'audit')
      api<Row[]>('/audit-logs')
        .then(setLogs)
        .catch((e) => setError(e.message))
  }, [tab])
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ ratio, minimum }) })
      notify('规则已保存，历史订单金额不受影响')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageTitle title="系统设置" subtitle="清晰的规则，让每一份回馈更有保障。" />
      <section className="panel settings-panel">
        <div className="settings-tabs">
          {[
            ['rules', '返现与提现规则'],
            ['security', '账户安全'],

            ['audit', '操作审计'],
          ].map(([value, label]) => (
            <button className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>
              {label}
            </button>
          ))}
        </div>
        {error && <ErrorBox message={error} />}
        <div className="settings-body">
          {tab === 'security' ? (
            <ChangePassword notify={notify} />
          ) : tab === 'rules' ? (
            <form onSubmit={save}>
              <h2>默认返现规则</h2>
              <p className="muted">规则持久保存到数据库。历史订单使用下单时的比例快照。</p>
              <label className="form-field">
                全局默认返现比例（%）
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  required
                  value={ratio}
                  onChange={(e) => setRatio(Number(e.target.value))}
                />
                <small>用户预计返现 = 有效佣金 × 返现比例</small>
              </label>
              <label className="form-field">
                最低提现金额（元）
                <input
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  required
                  value={minimum}
                  onChange={(e) => setMinimum(Number(e.target.value))}
                />
                <small>用户通过企业微信发送 /提现 申请，必须人工审核与打款。</small>
              </label>
              <div className="info-box">
                <ShieldCheck size={19} />
                <span>规则优先级：用户平台专属 → 用户默认 → 平台默认 → 全局默认。当前支持全局与用户比例配置。</span>
              </div>
              <button className="primary" type="submit" disabled={busy}>
                {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}保存规则
              </button>
            </form>
          ) : (
            <>
              <h2>操作审计</h2>
              <p className="muted">后台操作记录持久保存，服务重启后仍可查询。</p>
              {logs.length ? (
                <table>
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
                        <td>{String(r.target)}</td>
                        <td>{String(r.actor)}</td>
                        <td>{new Date(String(r.createdAt)).toLocaleString('zh-CN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state">
                  <FileText size={30} />
                  <h3>暂无操作记录</h3>
                  <p>修改规则、用户或审核提现后，记录会出现在这里。</p>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
