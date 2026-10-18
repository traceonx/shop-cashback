import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/**
 * 浮层：挂到 body，按触发元素定位（下方放不下时翻到上方），
 * 点击外部、Esc、窗口尺寸变化时关闭或重新定位。
 */
export function Popover({
  anchor,
  open,
  onClose,
  matchWidth = false,
  className = '',
  children,
}: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  matchWidth?: boolean
  className?: string
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      const p = panel.current
      if (!a || !p) return
      const gap = 6
      const h = p.offsetHeight
      const w = matchWidth ? a.width : p.offsetWidth
      const below = window.innerHeight - a.bottom - gap
      const top = below >= h || a.top < h ? a.bottom + gap : a.top - gap - h
      const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8))
      setStyle({ top, left, width: matchWidth ? a.width : undefined, visibility: 'visible' })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor, matchWidth])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [open, onClose, anchor])

  if (!open) return null
  return createPortal(
    <div ref={panel} className={`popover ${className}`} style={style}>
      {children}
    </div>,
    document.body,
  )
}
