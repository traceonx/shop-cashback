import { useId, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cx } from '../lib/format'
import { FieldShell, type FieldProps } from './Field'
import { Popover } from './Popover'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

/** 周一开头的 6 行日历；mark 返回日期的选中 / 区间样式 */
function Calendar({
  month,
  setMonth,
  mark,
  onPick,
  foot,
}: {
  month: Date
  setMonth: (d: Date) => void
  mark: (v: string) => string | false
  onPick: (v: string) => void
  foot: ReactNode
}) {
  const today = iso(new Date())
  const first = new Date(month)
  first.setDate(1 - ((month.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i))
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  return (
    <>
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
              data-day={v}
              className={cx('calendar-day', d.getMonth() !== month.getMonth() && 'is-outside', v === today && 'is-today', mark(v))}
              onClick={() => onPick(v)}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
      <div className="calendar-foot">{foot}</div>
    </>
  )
}
const monthOf = (v: string) => {
  const d = v ? new Date(`${v}T00:00:00`) : new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

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
  const [month, setMonth] = useState(() => monthOf(value))
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
          if (!open && value) setMonth(monthOf(value))
          setOpen(!open)
        }}
      >
        {value || placeholder}
      </button>
      <Popover anchor={control} open={open} onClose={() => setOpen(false)} className="calendar">
        <Calendar
          month={month}
          setMonth={setMonth}
          mark={(v) => v === value && 'is-selected'}
          onPick={pick}
          foot={
            <>
              <button type="button" className="btn btn-text btn-sm" onClick={() => pick(iso(new Date()))}>
                今天
              </button>
              <button type="button" className="btn btn-text btn-sm" onClick={() => pick('')}>
                清除
              </button>
            </>
          }
        />
      </Popover>
    </FieldShell>
  )
}

export type DateRange = { from: string; to: string }
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000))

/**
 * 日期区间选择：先点开始日期，再点结束日期（点在开始之前则互换）；值为 YYYY-MM-DD，空字符串表示未选择。
 * 底部提供今天 / 近 7 天 / 近 30 天快捷选项。
 */
export function DateRangePicker({
  value,
  onChange,
  placeholder = '选择日期范围',
  'aria-label': ariaLabel,
  ...field
}: FieldProps & { value: DateRange; onChange: (v: DateRange) => void; placeholder?: string; 'aria-label'?: string }) {
  const id = useId()
  const control = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => monthOf(value.from))
  // 已点开始日期、等待结束日期
  const [start, setStart] = useState('')
  const [hover, setHover] = useState('')
  const set = (v: DateRange) => {
    onChange(v)
    setStart('')
    setOpen(false)
  }
  const pick = (v: string) => {
    if (!start) return setStart(v)
    set(v < start ? { from: v, to: start } : { from: start, to: v })
  }
  // 选择中按悬停日期预览区间
  const [lo, hi] = start ? [start, hover || start].sort() : [value.from, value.to]
  const text = value.from ? (value.from === value.to ? value.from : `${value.from} 至 ${value.to}`) : ''

  return (
    <FieldShell
      id={id}
      icon={CalendarDays}
      {...field}
      focused={open}
      controlRef={control}
      trailing={
        value.from ? (
          <button type="button" className="icon-btn icon-btn-sm" aria-label="清除日期" onClick={() => onChange({ from: '', to: '' })}>
            <X size={14} />
          </button>
        ) : undefined
      }
    >
      <button
        id={id}
        type="button"
        className={cx('select-trigger', !text && 'is-placeholder')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (!open && value.from) setMonth(monthOf(value.from))
          setStart('')
          setOpen(!open)
        }}
      >
        {text || placeholder}
      </button>
      <Popover
        anchor={control}
        open={open}
        onClose={() => {
          setStart('')
          setOpen(false)
        }}
        className="calendar"
      >
        <div onMouseOver={(e) => setHover((e.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day || '')}>
          <Calendar
            month={month}
            setMonth={setMonth}
            mark={(v) => (v === lo || v === hi ? 'is-selected' : !!lo && v > lo && v < hi && 'is-in-range')}
            onPick={pick}
            foot={
              <>
                <button type="button" className="btn btn-text btn-sm" onClick={() => set({ from: iso(new Date()), to: iso(new Date()) })}>
                  今天
                </button>
                <button type="button" className="btn btn-text btn-sm" onClick={() => set({ from: daysAgo(6), to: iso(new Date()) })}>
                  近 7 天
                </button>
                <button type="button" className="btn btn-text btn-sm" onClick={() => set({ from: daysAgo(29), to: iso(new Date()) })}>
                  近 30 天
                </button>
                <button type="button" className="btn btn-text btn-sm" onClick={() => set({ from: '', to: '' })}>
                  清除
                </button>
              </>
            }
          />
        </div>
        {start && <div className="calendar-hint">请选择结束日期</div>}
      </Popover>
    </FieldShell>
  )
}
