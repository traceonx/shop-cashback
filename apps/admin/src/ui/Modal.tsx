import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, type LucideIcon } from 'lucide-react'
import { cx } from '../lib/format'
import { IconButton } from './Button'

let openCount = 0

/**
 * 弹窗：头部（标题 / 操作）与底部（按钮）固定，中间内容区独立滚动。
 * - size：sm 560 / md 720 / lg 960 / xl 1200（xl 固定高度，适合日志等长列表）
 * - toolbar：头部下方的固定区域（筛选、搜索等）
 * - dismissible=false 时（如保存中）禁止 Esc / 点遮罩关闭
 * 手机端 md 及以上全屏显示。
 */
export function Modal({
  title,
  subtitle,
  icon: Icon,
  size = 'sm',
  actions,
  toolbar,
  footer,
  footerNote,
  flush = false,
  dismissible = true,
  onClose,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: LucideIcon
  size?: 'sm' | 'md' | 'lg' | 'xl'
  actions?: ReactNode
  toolbar?: ReactNode
  footer?: ReactNode
  footerNote?: ReactNode
  flush?: boolean
  dismissible?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const latest = useRef({ onClose, dismissible })
  latest.current = { onClose, dismissible }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    if (openCount++ === 0) document.body.style.overflow = 'hidden'
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && latest.current.dismissible) latest.current.onClose()
      if (e.key !== 'Tab' || !panel.current) return
      const items = panel.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
      )
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (--openCount === 0) document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [])

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose()
      }}
    >
      <div
        ref={panel}
        className={cx('modal', size !== 'sm' && `modal-${size}`)}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
      >
        <header className="modal-header">
          {Icon && (
            <span className="modal-header-icon">
              <Icon size={22} />
            </span>
          )}
          <div className="modal-title">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="modal-header-actions">{actions}</div>}
          <IconButton icon={X} label="关闭" onClick={onClose} disabled={!dismissible} />
        </header>
        {toolbar && <div className="modal-toolbar">{toolbar}</div>}
        <div className={cx('modal-body', flush && 'modal-body-flush')}>{children}</div>
        {(footer || footerNote) && (
          <footer className="modal-footer">
            {footerNote && <span className="modal-footer-note">{footerNote}</span>}
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
