import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { cx } from '../lib/format'

type Variant = 'primary' | 'tonal' | 'outlined' | 'text' | 'danger'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'md' | 'sm'
  icon?: LucideIcon
  loading?: boolean
  block?: boolean
}

/** 按钮：primary 实心 / tonal 浅色 / outlined 描边 / text 文字 / danger 危险操作 */
export function Button({
  variant = 'tonal',
  size = 'md',
  icon: Icon,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  )
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  size?: 'md' | 'sm'
  spinning?: boolean
  badge?: ReactNode
}

/** 圆形图标按钮，label 用作无障碍名称和提示 */
export function IconButton({ icon: Icon, label, size = 'md', spinning, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('icon-btn', size === 'sm' && 'icon-btn-sm', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon size={size === 'sm' ? 16 : 20} className={spinning ? 'spin' : undefined} />
    </button>
  )
}
