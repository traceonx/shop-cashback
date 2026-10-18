import { ShoppingCart } from 'lucide-react'
import type { Row } from '../lib/api'
import { cx } from '../lib/format'

/** 商品缩略图 */
export function Thumb({ src, large = false }: { src?: unknown; large?: boolean }) {
  return (
    <span className={cx('thumb', large && 'thumb-lg')}>
      {typeof src === 'string' && src ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <ShoppingCart size={large ? 28 : 18} />
      )}
    </span>
  )
}

/** 表格中的商品单元格：缩略图 + 名称 + 副信息 */
export function ProductCell({ row, sub }: { row: Row; sub?: string }) {
  return (
    <div className="cell-media">
      <Thumb src={row.imageUrl} />
      <div>
        <strong>{String(row.product ?? '—')}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  )
}
