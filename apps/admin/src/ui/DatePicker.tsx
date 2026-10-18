import { useId, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cx } from '../lib/format'
import { FieldShell, type FieldProps } from './Field'
import { Popover } from './Popover'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

/** 日期选择：值为 YYYY-MM-DD 字符串，空字符串表示未选择 */
export function DatePicker({
  value,
  onChange,
  placeholder = '选择日期',
  'aria-label': ariaLabel,
  ...field
}: FieldProps & { value: string; onChange: (v: string) => void; placeholder?: string; 'aria-label'?: string }) {
  const id = useId()
  const control = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selected = value ? new Date(`${value}T00:00:00`) : null
  const [month, setMonth] = useState(() => {
    const d = selected || new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const today = iso(new Date())

  // 周一开头的 6 行日历
  const first = new Date(month)
  first.setDate(1 - ((month.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i))
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <FieldShell
      id={id}
      icon={CalendarDays}
      {...field}
      focused={open}
      controlRef={control}
      trailing={
        value ? (
          <button type="button" className="icon-btn icon-btn-sm" aria-label="清除日期" onClick={() => onChange('')}>
            <X size={14} />
          </button>
        ) : undefined
      }
    >
      <button
        id={id}
        type="button"
        className={cx('select-trigger', !value && 'is-placeholder')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (!open && selected) setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1))
          setOpen(!open)
        }}
      >
        {value || placeholder}
      </button>
      <Popover anchor={control} open={open} onClose={() => setOpen(false)} className="calendar">
        <div className="calendar-head">
          <button type="button" className="icon-btn icon-btn-sm" aria-label="上个月" onClick={() => shift(-1)}>
            <ChevronLeft size={16} />
          </button>
          <strong>
            {month.getFullYear()} 年 {month.getMonth() + 1} 月
          </strong>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="下个月" onClick={() => shift(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="calendar-grid">
          {WEEK.map((w) => (
            <span key={w} className="calendar-week">
              {w}
            </span>
          ))}
          {days.map((d) => {
            const v = iso(d)
            return (
              <button
                key={v}
                type="button"
                className={cx('calendar-day', d.getMonth() !== month.getMonth() && 'is-outside', v === today && 'is-today', v === value && 'is-selected')}
                onClick={() => pick(v)}
              >
                {d.getDate()}
              </button>
            )
          })}
        </div>
        <div className="calendar-foot">
          <button type="button" className="btn btn-text btn-sm" onClick={() => pick(today)}>
            今天
          </button>
          <button type="button" className="btn btn-text btn-sm" onClick={() => pick('')}>
            清除
          </button>
        </div>
      </Popover>
    </FieldShell>
  )
}
