import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from '../lib/format'
import { FieldShell, type FieldProps } from './Field'
import { Popover } from './Popover'

export type Option<T extends string | number> = [value: T, label: string]

/** 下拉选择：自绘选项面板（支持键盘上下、回车、Esc），外观与输入框一致 */
export function Select<T extends string | number>({
  value,
  onChange,
  options,
  placeholder = '请选择',
  disabled,
  'aria-label': ariaLabel,
  ...field
}: FieldProps & {
  value: T
  onChange: (v: T) => void
  options: Option<T>[]
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
}) {
  const id = useId()
  const control = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const current = options.find(([v]) => v === value)

  useEffect(() => {
    if (!open) return
    const i = Math.max(0, options.findIndex(([v]) => v === value))
    setActive(i)
    requestAnimationFrame(() => list.current?.children[i]?.scrollIntoView({ block: 'nearest' }))
  }, [open])

  const choose = (v: T) => {
    onChange(v)
    setOpen(false)
    trigger.current?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) e.preventDefault()
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') setActive((i) => Math.min(options.length - 1, i + 1))
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
    else if (e.key === 'Enter' || e.key === ' ') options[active] && choose(options[active][0])
    else if (e.key === 'Tab') setOpen(false)
  }
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  return (
    <FieldShell
      id={id}
      {...field}
      focused={open}
      controlRef={control}
      trailing={<ChevronDown size={16} className={cx('select-arrow', open && 'is-open')} />}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        className={cx('select-trigger', !current && 'is-placeholder')}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={onKey}
      >
        {current ? current[1] : placeholder}
      </button>
      <Popover anchor={control} open={open} onClose={() => setOpen(false)} matchWidth className="select-panel">
        <ul ref={list} role="listbox" aria-label={ariaLabel || field.label}>
          {options.map(([v, label], i) => (
            <li
              key={String(v)}
              role="option"
              aria-selected={v === value}
              className={cx('select-option', i === active && 'is-active')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(v)}
            >
              <span>{label}</span>
              {v === value && <Check size={16} />}
            </li>
          ))}
        </ul>
      </Popover>
    </FieldShell>
  )
}
