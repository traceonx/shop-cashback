import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Download, ExternalLink, Search, X, Pause, Play } from 'lucide-react'
import { api } from './api'

type Level = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
type Entry = { id: number; time: string; level: Level; source: string; message: string }
const levels: ('ALL' | Level)[] = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR']
const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const day = (d: Date) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())},${pad(d.getMilliseconds(), 3)}`

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
        if (alive) setError((e as Error).message)
      }
    }
    void pull()
    const timer = setInterval(pull, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [paused])

  useEffect(() => {
    if (!onClose) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => (level === 'ALL' || e.level === level) && (!q || `${e.source} ${e.message}`.toLowerCase().includes(q)))
  }, [entries, level, query])

  useEffect(() => {
    if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [shown])

  async function download() {
    const token = sessionStorage.getItem('rebate-token-v2')
    const res = await fetch('/api/v1/system/logs/download', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) return setError('下载失败')
    const url = URL.createObjectURL(await res.blob())
    const a = Object.assign(document.createElement('a'), { href: url, download: `shop-cashback-${Date.now()}.log` })
    a.click()
    URL.revokeObjectURL(url)
  }

  const panel = (
    <div className={'log-panel' + (standalone ? ' standalone' : '')} role="dialog" aria-label="实时日志">
      <header className="log-head">
        <FileText size={26} />
        <h2>实时日志</h2>
        <button type="button" className="log-chip" onClick={download}><Download size={14} />下载</button>
        {!standalone && (
          <button type="button" className="log-chip" onClick={() => window.open('/logs', '_blank')}><ExternalLink size={14} />在新窗口中打开</button>
        )}
        <button type="button" className="log-chip" onClick={() => setPaused(!paused)}>
          {paused ? <Play size={14} /> : <Pause size={14} />}{paused ? '继续' : '暂停'}
        </button>
        {onClose && <button type="button" className="log-close" onClick={onClose} aria-label="关闭"><X size={22} /></button>}
      </header>
      <div className="log-tools">
        <div className="log-levels">
          {levels.map((l) => (
            <button type="button" key={l} className={`lv-${l.toLowerCase()}` + (level === l ? ' active' : '')} onClick={() => setLevel(l)}>
              {l === 'ALL' ? '全部' : l}
            </button>
          ))}
        </div>
        <label className="log-search">
          <Search size={20} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索日志内容" />
        </label>
      </div>
      {error && <p className="error-box" role="alert">{error}</p>}
      <div
        className="log-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {shown.length ? (
          shown.map((e) => {
            const d = new Date(e.time)
            return (
              <div className="log-row" key={e.id}>
                <span className="log-date">{day(d)}</span>
                <div className={`log-card lv-${e.level.toLowerCase()}`}>
                  <i />
                  <b>{e.level}:</b>
                  <span className="log-clock">{clock(d)}</span>
                  <span className="log-msg">{e.source} - {e.message}</span>
                </div>
              </div>
            )
          })
        ) : (
          <p className="log-empty">{entries.length ? '没有符合条件的日志' : '暂无日志'}</p>
        )}
      </div>
    </div>
  )
  return standalone ? <div className="log-page">{panel}</div> : (
    <div className="log-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>{panel}</div>
  )
}
