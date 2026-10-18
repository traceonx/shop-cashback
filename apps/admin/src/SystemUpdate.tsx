import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

type Version = { version: string; commit: string; builtAt: string | null }
type Status = {
  current: Version
  latest: string | null
  latestError: string | null
  imageChanged: boolean | null
  imageError: string | null
  hasUpdate: boolean
  docker: { available: boolean; reason: string; name?: string; image?: string }
  state: {
    running: boolean
    phase?: 'prepare' | 'pull' | 'recreate' | 'restarting'
    progress?: { percent: number; current: number; total: number; layers: number; done: number }
    fromVersion?: string
    startedAt?: string
    finishedAt?: string
    success?: boolean | null
    message?: string
    log?: string
  }
}
const steps = [
  { key: 'pull', label: '下载新镜像' },
  { key: 'recreate', label: '重建容器' },
  { key: 'restarting', label: '服务重启' },
] as const
const mb = (n = 0) => (n / 1048576).toFixed(1)
const elapsed = (from?: string) => {
  if (!from) return ''
  const s = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 1000))
  return s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s} 秒`
}
const time = (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—')

export function SystemUpdate() {
  const [status, setStatus] = useState<Status>()
  const [error, setError] = useState('')
  const [restarting, setRestarting] = useState(false)
  const [busy, setBusy] = useState(false)
  const before = useRef<string | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      const s = await api<Status>('/system/update')
      setStatus(s)
      setError('')
      if (before.current && s.current.version !== before.current) {
        setRestarting(false)
        setTimeout(() => location.reload(), 1500)
      }
      return s
    } catch (e) {
      // 更新过程中服务会被替换，暂时无法访问属于正常现象
      if (before.current) setRestarting(true)
      else setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!status?.state.running && !restarting) return
    const timer = setInterval(() => void load(), 1500)
    return () => clearInterval(timer)
  }, [status?.state.running, restarting, load])

  async function start() {
    if (!status || !confirm(`确认更新？更新期间服务会重启约 1 分钟。\n当前 v${status.current.version}${status.latest ? `，最新 v${status.latest}` : ''}`)) return
    setBusy(true)
    setError('')
    try {
      before.current = status.current.version
      await api('/system/update', { method: 'POST' })
      await load()
    } catch (e) {
      before.current = undefined
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!status) return error ? <p className="error-box" role="alert">{error}</p> : <p>正在读取版本信息…</p>
  const { current, latest, docker, state } = status
  const running = state.running || restarting
  return (
    <div>
      <h2>版本与更新</h2>
      <p className="muted">镜像由 GitHub Actions 自动构建并发布到 Docker Hub；一键更新会拉取当前标签的最新镜像并重建容器，数据保留在 data 卷中。</p>
      <table>
        <tbody>
          <tr><th>当前版本</th><td><b>v{current.version}</b>　提交 {current.commit}　构建于 {current.builtAt || '本地开发'}</td></tr>
          <tr>
            <th>最新版本</th>
            <td>
              {latest ? <>v{latest} </> : null}
              {status.hasUpdate ? (
                <span className="badge purple">{latest ? '有新版本' : '镜像仓库有新镜像'}</span>
              ) : status.imageChanged === false || latest ? (
                <span className="badge green">已是最新</span>
              ) : (
                <span className="muted">无法获取（{status.imageError || status.latestError || '未知原因'}）</span>
              )}
            </td>
          </tr>
          <tr><th>运行镜像</th><td>{docker.image || '—'}{docker.name ? `（容器 ${docker.name}）` : ''}</td></tr>
        </tbody>
      </table>
      {error && <p className="error-box" role="alert">{error}</p>}
      {!docker.available && <div className="info-box"><span>一键更新不可用：{docker.reason}</span></div>}
      {running && (
        <div className="update-progress" role="status" aria-live="polite">
          <ol className="update-steps">
            {steps.map((st, i) => {
              const at = restarting ? 2 : state.phase === 'restarting' ? 2 : state.phase === 'recreate' ? 1 : 0
              return <li key={st.key} className={i < at ? 'done' : i === at ? 'active' : ''}><i>{i < at ? '✓' : i + 1}</i>{st.label}</li>
            })}
          </ol>
          {(state.phase === 'pull' || state.phase === 'prepare') && !restarting && (
            <>
              <div className="update-bar"><span style={{ width: `${state.progress?.percent ?? 0}%` }} /></div>
              <p className="update-meta">
                <b>{state.progress?.percent ?? 0}%</b>
                {state.progress?.total ? ` · ${mb(state.progress.current)} / ${mb(state.progress.total)} MB · 镜像层 ${state.progress.done}/${state.progress.layers}` : ' · 正在连接镜像仓库…'}
              </p>
            </>
          )}
          {(state.phase === 'recreate' || state.phase === 'restarting' || restarting) && (
            <div className="update-bar indeterminate"><span /></div>
          )}
          <p className="update-meta">
            {restarting ? '服务正在重启，完成后页面会自动刷新…' : state.message}
            {state.startedAt && <span> · 已用时 {elapsed(state.startedAt)}</span>}
          </p>
        </div>
      )}
      {running ? null : state.message ? (
        <div className={state.running ? 'info-box' : state.success === false ? 'error-box' : 'save-success'}>
          <span>{state.running ? '更新中：' : `上次更新（${time(state.finishedAt || state.startedAt)}）：`}{state.message}</span>
        </div>
      ) : null}
      {state.log && !running && <pre className="update-log">{state.log}</pre>}
      <button className="primary" disabled={!docker.available || running || busy} onClick={start}>
        {running ? '更新中…' : status.hasUpdate ? (latest ? `更新到 v${latest}` : '立即更新') : '检查并更新'}
      </button>
    </div>
  )
}
