import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../lib/format'

export type FieldProps = {
  label?: string
  hint?: ReactNode
  icon?: LucideIcon
  trailing?: ReactNode
  dense?: boolean
  className?: string
}

/** 字段外壳：边框、浮动标签、前置图标、后置内容、提示文字。所有输入类组件共用 */
export function FieldShell({
  id,
  label,
  hint,
  icon: Icon,
  trailing,
  dense,
  className,
  focused,
  controlRef,
  children,
}: FieldProps & { id?: string; focused?: boolean; controlRef?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div className={cx('field', dense && 'field-dense', className)}>
      <div ref={controlRef} className={cx('field-control', focused && 'is-focused')}>
        {label && (
          <label className="field-label" htmlFor={id}>
            {label}
          </label>
        )}
        {Icon && (
          <span className="field-icon">
            <Icon size={dense ? 17 : 20} />
          </span>
        )}
        {children}
        {trailing && <span className="field-trailing">{trailing}</span>}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

/** 文本输入框。secret=true 时自带「显示 / 隐藏」切换 */
export function TextField({
  label,
  hint,
  icon,
  trailing,
  dense,
  className,
  secret = false,
  id,
  ...input
}: FieldProps & InputHTMLAttributes<HTMLInputElement> & { secret?: boolean }) {
  const auto = useId()
  const [shown, setShown] = useState(false)
  const fieldId = id || auto
  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      icon={icon}
      dense={dense}
      className={className}
      trailing={
        secret || trailing ? (
          <>
            {trailing}
            {secret && (
              <button type="button" className="btn btn-text" onClick={() => setShown(!shown)}>
                {shown ? '隐藏' : '显示'}
              </button>
            )}
          </>
        ) : undefined
      }
    >
      <input id={fieldId} {...input} type={secret ? (shown ? 'text' : 'password') : input.type} />
    </FieldShell>
  )
}

/** 多行输入 */
export function TextArea({ label, hint, className, id, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId()
  return (
    <FieldShell id={id || auto} label={label} hint={hint} className={className}>
      <textarea id={id || auto} {...rest} />
    </FieldShell>
  )
}

/** 开关 */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch-track" />
      {label}
    </button>
  )
}
