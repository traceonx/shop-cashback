import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Box, Clock3, Download, Github, RefreshCw, Save } from 'lucide-react'
import { api } from '../lib/api'
import { dateTime, elapsed, errorText, mb } from '../lib/format'
import { Alert, Button, Card, CardBody, CardHeader, Chip, IconButton, Loading, Switch, TextField, confirm } from '../ui'

const CHANGELOG_URL = 'https://github.com/traceonx/shop-cashback/blob/main/CHANGELOG.md'

type AutoUpdate = { enabled: boolean; cron: string; next: string | null }
type Version = { version: string; commit: string; builtAt: string | null }
type Status = {
  current: Version
  latest: string | null
  latestError: string | null
  imageChanged: boolean | null
  imageError: string | null
  hasUpdate: boolean
  autoUpdate: AutoUpdate
  docker: { available: boolean; reason: string; name?: string; image?: string }
  state: {
    running: boolean
    phase?: 'prepare' | 'pull' | 'recreate' | 'restarting'
    progress?: { percent: number; current: number; total: number; layers: number; done: number }
    startedAt?: string
    finishedAt?: string
    success?: boolean | null
    message?: string
    log?: string
  }
}
const phaseText: Record<string, string> = { prepare: '准备中', pull: '下载新镜像', recreate: '重建容器', restarting: '服务重启' }

/** 版本与一键更新：显示当前 / 最新版本，更新时实时显示下载进度 */
export function SystemUpdate() {
  const [status, setStatus] = useState<Status>()
  const [cron, setCron] = useState('')
  const [savingAuto, setSavingAuto] = useState(false)
  const [error, setError] = useState('')
  const [restarting, setRestarting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const before = useRef<string | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      const s = await api<Status>('/system/update')
      setStatus(s)
      setCron((c) => c || s.autoUpdate.cron)
      setError('')
      if (before.current && s.current.version !== before.current) {
        setRestarting(false)
        setTimeout(() => location.reload(), 1500)
      }
    } catch (e) {
      // 更新过程中服务被替换，暂时无法访问属正常现象
      if (before.current) setRestarting(true)
      else setError(errorText(e))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!status?.state.running && !restarting) return
    const timer = setInterval(load, 1500)
    return () => clearInterval(timer)
  }, [status?.state.running, restarting, load])

  // 手动重新检查 Docker Hub 上的最新版本
  async function check() {
    setChecking(true)
    await load()
    setChecking(false)
  }
  async function start() {
    if (!status) return
    const ok = await confirm({
      title: '确认更新',
      okText: '开始更新',
      content: `当前 v${status.current.version}${status.latest ? `，将更新到 v${status.latest}` : ''}。更新期间服务会重启约 1 分钟，数据保留在 data 目录。`,
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      before.current = status.current.version
      await api('/system/update', { method: 'POST' })
      await load()
    } catch (e) {
      before.current = undefined
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveAuto(enabled: boolean) {
    if (!status) return
    setSavingAuto(true)
    setError('')
    try {
      const autoUpdate = await api<AutoUpdate>('/system/update/auto', { method: 'PUT', body: JSON.stringify({ enabled, cron }) })
      setStatus({ ...status, autoUpdate })
      setCron(autoUpdate.cron)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSavingAuto(false)
    }
  }

  if (!status) return <Card>{error ? <CardBody><Alert tone="error">{error}</Alert></CardBody> : <Loading />}</Card>
  const { current, latest, docker, state } = status
  const running = state.running || restarting
  const downloading = (state.phase === 'pull' || state.phase === 'prepare') && !restarting
  const percent = state.progress?.percent ?? 0

  return (
    <Card>
      <CardHeader
        icon={Box}
        title="版本与更新"
        subtitle="从 Docker Hub 获取 GitHub Actions 构建的最新镜像并重建容器，数据保留在 data 目录"
        actions={
          <Button variant="outlined" icon={Github} onClick={() => window.open(CHANGELOG_URL, '_blank', 'noopener')}>
            更新日志 <ArrowRight size={15} />
          </Button>
        }
      />
      <CardBody className="stack">
        <div className="info-strip">
          <div>
            <span>当前版本</span>
            <p>
              <b>v{current.version}</b>
              <small title={current.builtAt ? `构建于 ${current.builtAt}` : '本地开发'}>{current.commit}</small>
            </p>
          </div>
          <div>
            <span>最新版本</span>
            <p>
              {latest && <b>v{latest}</b>}
              <IconButton icon={RefreshCw} label="检查最新版本" size="sm" spinning={checking} disabled={checking || running} onClick={check} />
              {status.hasUpdate ? (
                <Chip>{latest ? '有新版本' : '有新镜像'}</Chip>
              ) : status.imageChanged === false || latest ? (
                <Chip tone="success">已是最新</Chip>
              ) : (
                <small>无法获取（{status.imageError || status.latestError || '未知原因'}）</small>
              )}
            </p>
          </div>
          <div>
            <span>运行镜像</span>
            <p>
              <b className="ellipsis" title={docker.name ? `容器 ${docker.name}` : undefined}>
                {docker.image || '—'}
              </b>
            </p>
          </div>
        </div>

        <div className="update-panel">
          <div className="auto-update">
            <Switch checked={status.autoUpdate.enabled} label="自动更新" onChange={(v) => !savingAuto && void saveAuto(v)} />
            <TextField
              dense
              icon={Clock3}
              aria-label="自动更新 cron 表达式"
              placeholder="0 4 * * *"
              className="auto-update-cron"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void saveAuto(status.autoUpdate.enabled)}
            />
            {cron.trim() !== status.autoUpdate.cron && (
              <Button variant="tonal" icon={Save} loading={savingAuto} onClick={() => saveAuto(status.autoUpdate.enabled)}>
                保存
              </Button>
            )}
            {status.autoUpdate.enabled && status.autoUpdate.next && <small className="text-faint">下次检查：{dateTime(status.autoUpdate.next)}</small>}
          </div>
          <p className="text-faint">按 cron 表达式（分 时 日 月 周，北京时间）检查新版本，有更新时自动执行，服务会重启约 1 分钟；默认每天 04:00。</p>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {!docker.available && <Alert tone="warning">一键更新不可用：{docker.reason}</Alert>}

        <div className="update-panel" aria-live="polite">
          {running ? (
            <>
              <div className={downloading ? 'progress' : 'progress indeterminate'}>
                <span style={downloading ? { width: `${percent}%` } : undefined} />
              </div>
              <p className="update-meta">
                {downloading && <strong>{percent}%</strong>}
                <span>
                  {downloading && state.progress?.total
                    ? `${mb(state.progress.current)} / ${mb(state.progress.total)} MB`
                    : restarting
                      ? '服务正在重启，完成后页面自动刷新…'
                      : state.message || phaseText[state.phase || 'prepare']}
                  {state.startedAt && ` · 已用时 ${elapsed(state.startedAt)}`}
                </span>
              </p>
              {downloading && state.message && <p className="text-faint">{state.message}</p>}
            </>
          ) : state.message ? (
            <p className={state.success === false ? 'text-error' : 'text-success'}>
              上次更新（{dateTime(state.finishedAt || state.startedAt)}）：{state.message}
            </p>
          ) : (
            <p className="text-muted">{status.hasUpdate ? `可更新到 v${latest ?? '最新镜像'}，更新期间服务会重启约 1 分钟。` : '当前已是最新版本。'}</p>
          )}
          {state.log && !running && <pre className="update-log">{state.log}</pre>}
          <div className="row row-end">
            <Button variant={running ? 'tonal' : 'primary'} icon={Download} loading={running || busy} disabled={!docker.available} onClick={start}>
              {running ? '更新中…' : status.hasUpdate ? (latest ? `更新到 v${latest}` : '立即更新') : '检查并更新'}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
