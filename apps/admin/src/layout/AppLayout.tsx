import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Banknote,
  Bot,
  Building2,
  FileText,
  Gift,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Settings,
  ShoppingCart,
  Sun,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { auth } from '../lib/api'
import { useTheme } from '../lib/theme'
import { cx } from '../lib/format'
import { Avatar, IconButton } from '../ui'
import { LogViewer } from '../pages/LogViewer'

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

const themeIcon = { system: Monitor, light: Sun, dark: Moon }
const themeLabel = { system: '跟随系统', light: '浅色', dark: '深色' }

/** 后台布局：左侧导航（≤1200px 变为抽屉）+ 吸顶顶栏 + 内容区 */
export function AppLayout({ onLogout, children }: { onLogout: () => void; children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { mode, next } = useTheme()
  const [drawer, setDrawer] = useState(false)
  const [logs, setLogs] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => setDrawer(false), [location.pathname])
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  return (
    <div className="layout">
      {drawer && <div className="nav-scrim" onClick={() => setDrawer(false)} />}
      <aside className={cx('nav', drawer && 'open')} aria-label="主导航">
        <a className="nav-header" href="/">
          <span className="nav-logo">
            <Gift size={18} />
          </span>
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

      <header className="navbar">
        <IconButton className="navbar-menu" icon={Menu} label="打开菜单" onClick={() => setDrawer(true)} />
        <span className="spacer" />
        <div className="navbar-actions">
          <IconButton icon={FileText} label="实时日志" onClick={() => setLogs(true)} />
          <IconButton icon={themeIcon[mode]} label={`主题：${themeLabel[mode]}（点击切换）`} onClick={next} />
          <div className="navbar-user" ref={menuRef}>
            <button type="button" aria-label="账户菜单" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <Avatar text="A" round />
            </button>
            {menu && (
              <div className="menu" role="menu">
                <div className="menu-head">
                  <Avatar text="A" round />
                  <div>
                    超级管理员
                    <small>admin</small>
                  </div>
                </div>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false)
                    navigate('/settings?tab=security')
                  }}
                >
                  <KeyRound size={18} />
                  修改密码
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    auth.clear()
                    onLogout()
                  }}
                >
                  <LogOut size={18} />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="page" key={location.pathname}>
        {children}
      </main>
      {logs && <LogViewer onClose={() => setLogs(false)} />}
    </div>
  )
}
