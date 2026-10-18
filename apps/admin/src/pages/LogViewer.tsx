import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, ExternalLink, FileText, Pause, Play, Search } from 'lucide-react'
import { api, download } from '../lib/api'
import { cx, errorText } from '../lib/format'
import { Alert, Button, Card, CardHeader, Modal, Segmented, TextField } from '../ui'

type Level = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
type Entry = { id: number; time: string; level: Level; source: string; message: string }
const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** 实时日志：弹窗（顶栏按钮）或独立页面（/logs） */
export function LogViewer({ onClose, standalone = false }: { onClose?: () => void; standalone?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [level, setLevel] = useState<'ALL' | Level>('ALL')
  const [query, setQuery] = useState('')
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState('')
  const last = useRef(0)
  const list = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (paused) return
    let alive = true
    const pull = async () => {
      try {
        const r = await api<{ entries: Entry[]; lastId: number }>(`/system/logs?after=${last.current}`)
        if (!alive) return
        if (r.lastId < last.current) setEntries(r.entries) // 服务重启后编号重置
        else if (r.entries.length) setEntries((old) => [...old, ...r.entries].slice(-2000))
        last.current = r.lastId
        setError('')
      } catch (e) {
        if (alive) setError(errorText(e))
      }
    }
    void pull()
    const timer = setInterval(pull, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [paused])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => (level === 'ALL' || e.level === level) && (!q || `${e.source} ${e.message}`.toLowerCase().includes(q)))
  }, [entries, level, query])
  useEffect(() => {
    if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [shown])

  const actions = (
    <>
      <Button variant="text" size="sm" icon={paused ? Play : Pause} onClick={() => setPaused(!paused)}>
        {paused ? '继续' : '暂停'}
      </Button>
      <Button variant="text" size="sm" icon={Download} onClick={() => download('/system/logs/download', `shop-cashback-${Date.now()}.log`).catch((e) => setError(errorText(e)))}>
        下载
      </Button>
      {!standalone && (
        <Button variant="text" size="sm" icon={ExternalLink} onClick={() => window.open('/logs', '_blank')}>
          新窗口
        </Button>
      )}
    </>
  )
  const toolbar = (
    <div className="row">
      <Segmented items={[['ALL', '全部'], ['DEBUG', 'DEBUG'], ['INFO', 'INFO'], ['WARNING', 'WARNING'], ['ERROR', 'ERROR']]} value={level} onChange={setLevel} />
      <TextField dense icon={Search} placeholder="搜索日志" aria-label="搜索日志" className="spacer" value={query} onChange={(e) => setQuery(e.target.value)} />
    </div>
  )
  const body = (
    <div
      className="log-list"
      ref={list}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      {shown.length ? (
        shown.map((e) => (
          <div className={cx('log-row', `log-${e.level.toLowerCase()}`)} key={e.id}>
            <span className="log-time">{stamp(new Date(e.time))}</span>
            <span className="log-level">{e.level}</span>
            <span className="log-msg">
              {e.source} - {e.message}
            </span>
          </div>
        ))
      ) : (
        <p className="log-empty">{entries.length ? '没有符合条件的日志' : '暂无日志'}</p>
      )}
    </div>
  )

  if (standalone)
    return (
      <div className="standalone">
        <Card className="log-card">
          <CardHeader icon={FileText} title="实时日志" actions={actions} />
          <div className="modal-toolbar">{toolbar}</div>
          {body}
        </Card>
      </div>
    )
  return (
    <Modal title="实时日志" icon={FileText} size="xl" flush actions={actions} toolbar={toolbar} onClose={onClose!}>
      {body}
    </Modal>
  )
}
