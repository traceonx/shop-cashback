import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { CheckCircle2, X } from 'lucide-react'
import { auth } from './lib/api'
import type { Notify } from './lib/format'
import { AppLayout } from './layout/AppLayout'
import { ConfirmHost, IconButton } from './ui'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Records } from './pages/Records'
import { Channels } from './pages/Channels'
import { Affiliates } from './pages/Affiliates'
import { Settings } from './pages/Settings'
import { Profile } from './pages/Profile'
import { LogViewer } from './pages/LogViewer'

export function App() {
  const [signed, setSigned] = useState(!!auth.token())
  const [toast, setToast] = useState('')
  const location = useLocation()
  const notify = useCallback<Notify>((message) => setToast(message), [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4500)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    const expired = () => setSigned(false)
    window.addEventListener('session-expired', expired)
    return () => window.removeEventListener('session-expired', expired)
  }, [])

  let content
  if (!signed) content = <Login onLogin={() => setSigned(true)} />
  else if (location.pathname === '/logs') content = <LogViewer standalone />
  else
    content = (
      <AppLayout onLogout={() => setSigned(false)} notify={notify}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {(['orders', 'users', 'rebates', 'withdrawals', 'promotions'] as const).map((kind) => (
            <Route key={kind} path={`/${kind}`} element={<Records key={kind} kind={kind} notify={notify} />} />
          ))}
          <Route path="/channels" element={<Channels />} />
          <Route path="/affiliates" element={<Affiliates />} />
          <Route path="/settings" element={<Settings notify={notify} />} />
          <Route path="/profile" element={<Profile notify={notify} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
    )

  return (
    <>
      {content}
      <ConfirmHost />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <IconButton icon={X} label="关闭提示" size="sm" onClick={() => setToast('')} />
        </div>
      )}
    </>
  )
}
