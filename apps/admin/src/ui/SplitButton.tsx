import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { Button } from './Button'
import { Popover } from './Popover'

/** 分体按钮：左侧执行默认操作，右侧箭头展开更多选项 */
export function SplitButton<T extends string>({
  icon,
  loading,
  onClick,
  options,
  onSelect,
  menuLabel,
  children,
}: {
  icon?: LucideIcon
  loading?: boolean
  onClick: () => void
  options: [T, string][]
  onSelect: (value: T) => void
  menuLabel: string
  children: ReactNode
}) {
  const group = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <div className="split-btn" ref={group}>
      <Button variant="primary" icon={icon} loading={loading} onClick={onClick}>
        {children}
      </Button>
      <button
        type="button"
        className="btn btn-primary split-btn-toggle"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={loading}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={16} />
      </button>
      <Popover anchor={group} open={open} onClose={() => setOpen(false)} matchWidth className="select-panel">
        <ul role="menu" aria-label={menuLabel}>
          {options.map(([value, label]) => (
            <li key={value} role="none">
              <button
                type="button"
                role="menuitem"
                className="select-option"
                onClick={() => {
                  setOpen(false)
                  onSelect(value)
                }}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  )
}
