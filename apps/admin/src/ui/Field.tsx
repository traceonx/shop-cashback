import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { cx } from '../lib/format'

type Common = {
  label?: string
  hint?: ReactNode
  icon?: LucideIcon
  trailing?: ReactNode
  dense?: boolean
  className?: string
}

function Shell({ id, label, hint, icon: Icon, trailing, dense, className, children }: Common & { id: string; children: ReactNode }) {
  return (
    <div className={cx('field', dense && 'field-dense', className)}>
      <div className="field-control">
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

/** 文本输入框（浮动标签）。secret=true 时自带「显示 / 隐藏」切换 */
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
}: Common & InputHTMLAttributes<HTMLInputElement> & { secret?: boolean }) {
  const auto = useId()
  const [shown, setShown] = useState(false)
  const fieldId = id || auto
  return (
    <Shell
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
    </Shell>
  )
}

/** 多行输入 */
export function TextArea({ label, hint, className, id, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId()
  return (
    <Shell id={id || auto} label={label} hint={hint} className={className}>
      <textarea id={id || auto} {...rest} />
    </Shell>
  )
}

/** 下拉选择 */
export function SelectField({
  label,
  hint,
  icon,
  dense,
  className,
  options,
  id,
  ...rest
}: Common & SelectHTMLAttributes<HTMLSelectElement> & { options: [string | number, string][] }) {
  const auto = useId()
  return (
    <Shell
      id={id || auto}
      label={label}
      hint={hint}
      icon={icon}
      dense={dense}
      className={className}
      trailing={<ChevronDown size={16} className="field-select-arrow" />}
    >
      <select id={id || auto} {...rest}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </Shell>
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
