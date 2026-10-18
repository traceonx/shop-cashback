import { Fragment } from 'react'
import type { LucideIcon } from 'lucide-react'

/** 标签页（下划线样式） */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: string; icon?: LucideIcon }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map(({ value: v, label, icon: Icon }) => (
        <button key={v} type="button" role="tab" className="tab" aria-selected={v === value} onClick={() => onChange(v)}>
          {Icon && <Icon size={18} />}
          {label}
        </button>
      ))}
    </div>
  )
}

/** 分段按钮 */
export function Segmented<T extends string | number>({
  items,
  value,
  onChange,
}: {
  items: [T, string][]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="group">
      {items.map(([v, label]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

/** 分页 */
export function Pagination({
  page,
  pages,
  total,
  onChange,
}: {
  page: number
  pages: number
  total: number
  onChange: (p: number) => void
}) {
  // 页码过多时只显示首尾与当前页附近
  const list = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 1)
  return (
    <div className="pagination">
      <span>共 {total} 条</span>
      <div className="pagination-pages">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页">
          ‹
        </button>
        {list.map((p, i) => (
          <Fragment key={p}>
            {i > 0 && p - list[i - 1] > 1 && <button disabled>…</button>}
            <button type="button" aria-current={p === page ? 'page' : undefined} onClick={() => onChange(p)}>
              {p}
            </button>
          </Fragment>
        ))}
        <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="下一页">
          ›
        </button>
      </div>
    </div>
  )
}
