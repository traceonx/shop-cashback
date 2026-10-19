import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'
import { TextArea } from '../ui'
import type { useIntegration } from './integration'

type Binding = { positionId: string; inPool: boolean; user: { id: string; name: string } | null; boundAt: string | null }
type Positions = { pool: Binding[]; free: number }

/** 京东联盟：用户独立推广位（推广位池与绑定情况） */
export function JdPositionPanel({ it }: { it: ReturnType<typeof useIntegration> }) {
  const [data, setData] = useState<Positions>()
  useEffect(() => {
    api<Positions>('/integrations/jd/positions').then(setData, () => setData(undefined))
  }, [it.data])
  return (
    <>
      <TextArea
        label="推广位池（用户独立推广位）"
        hint="在京东联盟后台「推广管理 → 推广位」建好后填入推广位 ID，每行一个；用户首次转京东链接时固定绑定一个空闲推广位，订单按推广位精确关联用户。池子用完时使用默认推广位，订单按商品匹配。已绑定用户的推广位不能移除"
        rows={4}
        placeholder={'3100000001\n3100000002'}
        value={it.values.positionPool ?? ''}
        onChange={(e) => it.set('positionPool', e.target.value)}
      />
      {data && data.pool.length > 0 && (
        <div className="oauth-box">
          <div>
            推广位池 {data.pool.filter((b) => b.inPool).length} 个，空闲 {data.free} 个
          </div>
          {data.pool.map((b) => (
            <div key={b.positionId} className="text-faint">
              {b.positionId} · {b.user ? `${b.user.name}（${b.boundAt ? dateTime(b.boundAt) : ''} 绑定）` : '空闲'}
              {!b.inPool && ' · 已不在池中'}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
