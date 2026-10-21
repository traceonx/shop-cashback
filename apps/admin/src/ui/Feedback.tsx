import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cx } from '../lib/format'
import { statusLabel, statusTone } from '../lib/labels'
import { Button } from './Button'
import { Avatar, type Tone } from './Card'

const alertIcons: Record<string, LucideIcon> = { info: Info, success: CheckCircle2, warning: TriangleAlert, error: AlertCircle }

/** 提示条：info / success / warning / error，可带重试 */
export function Alert({
  tone = 'info',
  children,
  retry,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error'
  children: ReactNode
  retry?: () => void
  className?: string
}) {
  const Icon = alertIcons[tone]
  return (
    <div className={cx('alert', tone !== 'info' && `alert-${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={18} />
      <span>{children}</span>
      {retry && (
        <Button size="sm" variant="text" onClick={retry}>
          重试
        </Button>
      )}
    </div>
  )
}

/** 标签 */
export function Chip({ tone = 'primary', dot = false, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return <span className={cx('chip', dot && 'chip-dot', tone !== 'primary' && `tone-${tone}`)}>{children}</span>
}

/** 业务状态标签（根据状态码自动配色与中文名） */
export function StatusChip({ value, text }: { value: string; text?: string | null }) {
  return (
    <Chip tone={statusTone(value)} dot>
      {text || statusLabel(value)}
    </Chip>
  )
}

/** 空状态 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <Avatar icon={icon} tone="secondary" size="lg" round />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}

/** 加载中 */
export function Loading({ text = '正在加载…' }: { text?: string }) {
  return (
    <div className="empty">
      <Loader2 size={24} className="spin" />
      <p>{text}</p>
    </div>
  )
}
