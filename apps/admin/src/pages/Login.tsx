import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, LogIn, User } from 'lucide-react'
import { api, auth } from '../lib/api'
import { errorText } from '../lib/format'
import { Alert, Button, Card, TextField } from '../ui'

export function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [initialized, setInitialized] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const checkSetup = async () => {
    setError('')
    try {
      setInitialized((await api<{ initialized: boolean }>('/auth/setup-status')).initialized)
    } catch (e) {
      setError(errorText(e))
    }
  }
  useEffect(() => {
    void checkSetup()
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (initialized === null) return
    setBusy(true)
    setError('')
    try {
      if (!initialized) {
        if (password !== confirm) throw new Error('两次输入的密码不一致')
        await api('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) })
        setInitialized(true)
      }
      const r = await api<{ token: string; role: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      auth.save(r.token, r.role)
      onLogin()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const creating = initialized === false
  return (
    <div className="login">
      <Card className="login-card">
        <div className="login-brand">
          <img className="nav-logo" src="/logo.svg" alt="" />
          <span className="nav-brand">拾惠</span>
        </div>
        <h1>{creating ? '创建管理员账号' : '欢迎回来'}</h1>
        <p className="text-muted">{creating ? '首次使用，设置用户名和密码即可开始。' : '登录返利管理后台'}</p>
        <form className="stack" onSubmit={submit}>
          <TextField label="用户名" icon={User} autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          <TextField
            label="密码"
            icon={KeyRound}
            secret
            autoComplete={creating ? 'new-password' : 'current-password'}
            required
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {creating && (
            <TextField
              label="确认密码"
              icon={KeyRound}
              secret
              autoComplete="new-password"
              required
              maxLength={128}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
          {error && <Alert tone="error" retry={initialized === null ? checkSetup : undefined}>{error}</Alert>}
          <Button type="submit" variant="primary" icon={LogIn} block loading={busy} disabled={initialized === null}>
            {creating ? '创建并登录' : '登录'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
