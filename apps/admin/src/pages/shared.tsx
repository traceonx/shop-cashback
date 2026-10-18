import { ShoppingCart } from 'lucide-react'
import type { Row } from '../lib/api'
import { cx } from '../lib/format'
import { PlatformRibbon } from '../ui'

/** 商品缩略图，可在左上角显示平台角标 */
export function Thumb({ src, large = false, platform }: { src?: unknown; large?: boolean; platform?: string }) {
  const image = (
    <span className={cx('thumb', large && 'thumb-lg')}>
      {typeof src === 'string' && src ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <ShoppingCart size={large ? 28 : 18} />
      )}
    </span>
  )
  if (!platform) return image
  return (
    <span className="thumb-wrap">
      {image}
      <PlatformRibbon platform={platform} />
    </span>
  )
}

/** 表格中的商品单元格：缩略图 + 名称 + 副信息 */
export function ProductCell({ row, sub, platform }: { row: Row; sub?: string; platform?: string }) {
  return (
    <div className="cell-media">
      <Thumb src={row.imageUrl} platform={platform} />
      <div>
        <strong>{String(row.product ?? '—')}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  )
}
