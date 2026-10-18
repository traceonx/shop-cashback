import type { HTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../lib/format'

export type Tone = 'primary' | 'success' | 'info' | 'warning' | 'error' | 'secondary'

/** 卡片容器 */
export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cx('card', className)} {...rest} />
}

/** 卡片头部：可选图标、标题、副标题、右侧操作 */
export function CardHeader({
  title,
  subtitle,
  icon,
  tone = 'primary',
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: LucideIcon
  tone?: Tone
  actions?: ReactNode
}) {
  return (
    <header className="card-header">
      {icon && <Avatar icon={icon} tone={tone} />}
      <div className="card-title">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="card-actions">{actions}</div>}
    </header>
  )
}

export function CardBody({ flush = false, className, ...rest }: HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return <div className={cx(flush ? 'card-body-flush' : 'card-body', className)} {...rest} />
}

/** 带色调的方形图标 / 文字头像 */
export function Avatar({
  icon: Icon,
  text,
  tone = 'primary',
  size = 'md',
  round = false,
}: {
  icon?: LucideIcon
  text?: string
  tone?: Tone
  size?: 'sm' | 'md' | 'lg'
  round?: boolean
}) {
  return (
    <span className={cx('avatar', size !== 'md' && `avatar-${size}`, round && 'avatar-round', tone !== 'primary' && `tone-${tone}`)}>
      {Icon ? <Icon size={size === 'lg' ? 26 : size === 'sm' ? 16 : 20} /> : text}
    </span>
  )
}

/** 统计卡片 */
export function StatCard({
  icon,
  tone,
  label,
  value,
  unit,
  caption,
}: {
  icon: LucideIcon
  tone: Tone
  label: string
  value: ReactNode
  unit?: string
  caption?: string
}) {
  return (
    <Card className="stat-card">
      <Avatar icon={icon} tone={tone} size="lg" />
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">
          {value}
          {unit && <small>{unit}</small>}
        </div>
        {caption && <div className="stat-caption">{caption}</div>}
      </div>
    </Card>
  )
}
