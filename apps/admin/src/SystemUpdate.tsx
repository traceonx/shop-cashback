import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Box, Github, LoaderCircle } from 'lucide-react'
import { api } from './api'

const CHANGELOG_URL = 'https://github.com/traceonx/shop-cashback/blob/main/CHANGELOG.md'

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
const phaseText: Record<string, string> = { prepare: '准备中', pull: '下载新镜像', recreate: '重建容器', restarting: '服务重启' }
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
  const downloading = (state.phase === 'pull' || state.phase === 'prepare') && !restarting
  const percent = restarting || state.phase === 'restarting' ? 100 : (state.progress?.percent ?? 0)
  const lastResult = !running && state.message
  return (
    <section className="upd-card">
      <header className="upd-head">
        <div className="upd-icon" aria-hidden="true"><Box size={30} strokeWidth={2} /></div>
        <div className="upd-title">
          <h2>版本与更新</h2>
          <p>自动从 GitHub Actions 获取最新镜像并更新容器，数据保留在 data 卷中。</p>
        </div>
        <a className="upd-link" href={CHANGELOG_URL} target="_blank" rel="noreferrer">
          <Github size={18} />查看更新日志<ArrowRight size={16} />
        </a>
      </header>

      <div className="upd-info">
        <div>
          <span>当前版本</span>
          <p><b>v{current.version}</b><small title={current.builtAt ? `构建于 ${current.builtAt}` : '本地开发'}>{current.commit}</small></p>
        </div>
        <div>
          <span>最新版本</span>
          <p>
            {latest ? <b>v{latest}</b> : null}
            {status.hasUpdate ? (
              <em className="upd-badge">{latest ? '有新版本' : '镜像仓库有新镜像'}</em>
            ) : status.imageChanged === false || latest ? (
              <em className="upd-badge green">已是最新</em>
            ) : (
              <small>无法获取（{status.imageError || status.latestError || '未知原因'}）</small>
            )}
          </p>
        </div>
        <div>
          <span>运行镜像</span>
          <p><b className="upd-mono" title={docker.name ? `容器 ${docker.name}` : undefined}>{docker.image || '—'}</b></p>
        </div>
      </div>

      {error && <p className="error-box" role="alert">{error}</p>}
      {!docker.available && <div className="info-box"><span>一键更新不可用：{docker.reason}</span></div>}

      <div className="upd-panel" role={running ? 'status' : undefined} aria-live="polite">
        {running ? (
          <>
            <div className={`upd-bar ${downloading ? '' : 'indeterminate'}`}>
              <span style={downloading ? { width: `${percent}%` } : undefined} />
            </div>
            <p className="upd-meta">
              {downloading && <strong>{percent}%</strong>}
              <span>
                {downloading && state.progress?.total
                  ? `${mb(state.progress.current)} / ${mb(state.progress.total)} MB`
                  : restarting
                    ? '服务正在重启，完成后页面会自动刷新…'
                    : state.message || phaseText[state.phase || 'prepare']}
                {state.startedAt && ` · 已用时 ${elapsed(state.startedAt)}`}
              </span>
            </p>
            {downloading && state.message && <p className="upd-sub">{state.message}</p>}
          </>
        ) : lastResult ? (
          <p className={`upd-result ${state.success === false ? 'fail' : 'ok'}`}>
            上次更新（{time(state.finishedAt || state.startedAt)}）：{state.message}
          </p>
        ) : (
          <p className="upd-sub">{status.hasUpdate ? `可以更新到 v${latest ?? '最新镜像'}，更新期间服务会重启约 1 分钟。` : '当前已是最新版本，也可以手动检查一次。'}</p>
        )}
        {state.log && !running && <pre className="update-log">{state.log}</pre>}
        <div className="upd-actions">
          <button className={`upd-btn ${running ? 'busy' : ''}`} disabled={!docker.available || running || busy} onClick={start}>
            {running && <LoaderCircle size={20} className="upd-spin" />}
            {running ? '更新中…' : status.hasUpdate ? (latest ? `更新到 v${latest}` : '立即更新') : '检查并更新'}
          </button>
        </div>
      </div>
    </section>
  )
}
