import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Banknote,
  Bot,
  Building2,
  Check,
  ChevronRight,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Settings,
  ShoppingCart,
  Sun,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { auth } from '../lib/api'
import { useTheme, type ThemeMode } from '../lib/theme'
import { cx, type Notify } from '../lib/format'
import { displayName, roleName, useProfile } from '../lib/profile'
import { IconButton } from '../ui'
import { UserAvatar } from './UserAvatar'
import { LogViewer } from '../pages/LogViewer'
import { Conversion } from '../pages/Conversion'

type NavItem = { path: string; label: string; icon: LucideIcon }
export const navigation: { title?: string; items: NavItem[] }[] = [
  { items: [{ path: '/', label: '数据概览', icon: LayoutDashboard }] },
  {
    title: '业务',
    items: [
      { path: '/orders', label: '订单管理', icon: ShoppingCart },
      { path: '/users', label: '用户管理', icon: Users },
      { path: '/rebates', label: '返现流水', icon: Wallet },
      { path: '/withdrawals', label: '提现审核', icon: Banknote },
    ],
  },
  {
    title: '配置',
    items: [
      { path: '/channels', label: '通知配置', icon: Bot },
      { path: '/affiliates', label: '渠道配置', icon: Building2 },
      { path: '/settings', label: '系统设置', icon: Settings },
    ],
  },
]

const themes: { value: ThemeMode; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
]

/** 后台布局：左侧导航（≤1200px 变为抽屉）+ 固定顶栏 + 独立滚动的内容区 */
export function AppLayout({ onLogout, notify, children }: { onLogout: () => void; notify: Notify; children: ReactNode }) {
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [logs, setLogs] = useState(false)
  const [converting, setConverting] = useState(false)

  useEffect(() => setDrawer(false), [location.pathname])

  return (
    <div className="layout">
      {drawer && <div className="nav-scrim" onClick={() => setDrawer(false)} />}
      <aside className={cx('nav', drawer && 'open')} aria-label="主导航">
        <a className="nav-header" href="/">
          <img className="nav-logo" src="/logo.svg" alt="" />
          <span className="nav-brand">拾惠</span>
        </a>
        <nav className="nav-items">
          {navigation.map((group, i) => (
            <div key={i}>
              {group.title && <div className="nav-section">{group.title}</div>}
              {group.items.map(({ path, label, icon: Icon }) => (
                <NavLink key={path} to={path} end={path === '/'} className="nav-link">
                  <Icon size={22} strokeWidth={1.8} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="nav-footer" title={`提交 ${__GIT_SHA__}`}>
          v{__APP_VERSION__}
        </div>
      </aside>

      <div className="main">
        <header className="navbar">
          <IconButton className="navbar-menu" icon={Menu} label="打开菜单" onClick={() => setDrawer(true)} />
          <span className="spacer" />
          <div className="navbar-actions">
            <IconButton icon={FileText} label="实时日志" onClick={() => setLogs(true)} />
            <AccountMenu onLogout={onLogout} onConvert={() => setConverting(true)} />
          </div>
        </header>
        <main className="page" key={location.pathname}>
          {children}
        </main>
      </div>
      {logs && <LogViewer onClose={() => setLogs(false)} />}
      {converting && <Conversion notify={notify} onClose={() => setConverting(false)} />}
    </div>
  )
}

/** 头像菜单：个人信息、转链测试、主题、退出登录 */
function AccountMenu({ onLogout, onConvert }: { onLogout: () => void; onConvert: () => void }) {
  const navigate = useNavigate()
  const profile = useProfile()
  const { mode, setMode } = useTheme()
  const [open, setOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return setThemeOpen(false)
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const current = themes.find((t) => t.value === mode)!
  return (
    <div className="navbar-user" ref={ref}>
      <button type="button" aria-label="账户菜单" aria-expanded={open} onClick={() => setOpen(!open)}>
        <UserAvatar profile={profile} />
      </button>
      {open && (
        <div className="menu account-menu" role="menu">
          <div className="menu-head">
            <UserAvatar profile={profile} size="lg" />
            <div>
              <small className="text-primary">{roleName(profile?.role)}</small>
              <strong>{displayName(profile)}</strong>
            </div>
          </div>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              navigate('/profile')
            }}
          >
            <UserRound size={20} />
            个人信息
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onConvert()
            }}
          >
            <Link2 size={20} />
            转链测试
          </button>
          <button type="button" className="menu-item" role="menuitem" aria-expanded={themeOpen} onClick={() => setThemeOpen(!themeOpen)}>
            <current.icon size={20} />
            <span className="menu-item-text">
              主题
              <small>{current.label}</small>
            </span>
            <ChevronRight size={16} className={cx('menu-chevron', themeOpen && 'is-open')} />
          </button>
          {themeOpen && (
            <div className="menu-sub">
              {themes.map((t) => (
                <button key={t.value} type="button" className="menu-item" role="menuitemradio" aria-checked={mode === t.value} onClick={() => setMode(t.value)}>
                  <t.icon size={18} />
                  <span className="menu-item-text">{t.label}</span>
                  {mode === t.value && <Check size={16} className="text-primary" />}
                </button>
              ))}
            </div>
          )}
          <div className="menu-foot">
            <button
              type="button"
              className="btn btn-block menu-logout"
              onClick={() => {
                auth.clear()
                onLogout()
              }}
            >
              <LogOut size={18} />
              退出登录
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
