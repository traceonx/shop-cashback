import { useEffect, useState, type ReactNode } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

type ConfirmOptions = { title: string; content: ReactNode; okText?: string; danger?: boolean }
type Pending = ConfirmOptions & { id: number; resolve: (ok: boolean) => void }

let show: ((p: Pending) => void) | null = null
let seq = 0

/**
 * 命令式确认弹窗（类似 Modal.confirm）：
 *   if (await confirm({ title: '确认更新', content: '…' })) { … }
 * 需要在应用根部渲染一次 <ConfirmHost />。
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(false)
    show({ ...options, id: ++seq, resolve })
  })
}

export function ConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([])
  useEffect(() => {
    show = (p) => setQueue((q) => [...q, p])
    return () => {
      show = null
    }
  }, [])
  const current = queue[0]
  if (!current) return null
  const done = (ok: boolean) => {
    current.resolve(ok)
    setQueue((q) => q.slice(1))
  }
  return (
    <ConfirmDialog
      key={current.id}
      title={current.title}
      confirmText={current.okText}
      danger={current.danger}
      onConfirm={() => done(true)}
      onCancel={() => done(false)}
    >
      {current.content}
    </ConfirmDialog>
  )
}
