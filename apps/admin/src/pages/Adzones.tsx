import { useEffect, useState } from 'react'
import { Save, ShoppingBag, Tag } from 'lucide-react'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'
import { Alert, Button, Card, CardBody, CardHeader, Loading, Switch, TextArea } from '../ui'
import { useIntegration } from './integration'
import { JdPositionPanel } from './JdPositionPanel'

type Binding = { adzone: string; pid: string | null; source: 'POOL' | 'CREATED'; user: { id: string; name: string } | null; boundAt: string | null }
type Adzones = { pool: Binding[]; created: Binding[]; free: number }

/** 淘宝：每个用户独立推广位开关、推广位池与绑定情况 */
function TaobaoAdzones() {
  const it = useIntegration('taobao')
  const [adzones, setAdzones] = useState<Adzones>()
  useEffect(() => {
    void it.details()
  }, [])
  useEffect(() => {
    api<Adzones>('/integrations/taobao/adzones').then(setAdzones, () => setAdzones(undefined))
  }, [it.data])
  const enabled = it.values.perUserAdzone !== 'false'
  return (
    <Card>
      <CardHeader
        title="淘宝联盟"
        subtitle="订单按推广位 ID（adzone_id）关联用户"
        icon={ShoppingBag}
        actions={
          <Button variant="primary" size="sm" icon={Save} loading={it.busy} disabled={!it.dirty} onClick={it.save}>
            保存
          </Button>
        }
      />
      <CardBody>
        {it.loading && !it.data ? (
          <Loading text="正在读取配置…" />
        ) : (
          <div className="stack">
            <Switch label="每个用户独立推广位" checked={enabled} onChange={(v) => it.set('perUserAdzone', v ? 'true' : 'false')} />
            <small className="text-faint">
              用户首次转淘宝链接时固定绑定一个推广位，之后都用它转链，订单的推广位 ID 精确对应用户（归属方式「联盟标识」）。先从推广位池取未绑定的；池子用完且开启喵有券淘宝接入时自动创建（喵有券付费接口）；都不行时使用默认推广位，订单按商品规则匹配。
            </small>
            {enabled && (
              <TextArea
                label="推广位池"
                hint="在淘宝联盟后台建好推广位后填入，每行一个 PID（mm_账号_网站_推广位），需与默认 PID 同一账号；已绑定用户的推广位不能移除"
                rows={5}
                placeholder={'mm_133091730_45556678_1234567890\nmm_133091730_45556678_1234567891'}
                value={it.values.adzonePool ?? ''}
                onChange={(e) => it.set('adzonePool', e.target.value)}
              />
            )}
            {adzones && adzones.pool.length + adzones.created.length > 0 && (
              <div className="oauth-box">
                <div>
                  推广位池 {adzones.pool.length} 个，空闲 {adzones.free} 个{adzones.created.length ? `；自动创建 ${adzones.created.length} 个` : ''}
                </div>
                {[...adzones.pool, ...adzones.created].map((b) => (
                  <div key={b.adzone} className="text-faint">
                    {b.pid || b.adzone} · {b.user ? `${b.user.name}（${b.boundAt ? dateTime(b.boundAt) : ''} 绑定）` : '空闲'}
                    {b.source === 'CREATED' && ' · 自动创建'}
                  </div>
                ))}
              </div>
            )}
            {it.error && <Alert tone="error">{it.error}</Alert>}
            {it.notice && <Alert tone="success">{it.notice}</Alert>}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/** 京东：推广位池与绑定情况 */
function JdPositions() {
  const it = useIntegration('jd')
  useEffect(() => {
    void it.details()
  }, [])
  return (
    <Card>
      <CardHeader
        title="京东联盟"
        subtitle="订单按推广位 ID（positionId）关联用户"
        icon={Tag}
        actions={
          <Button variant="primary" size="sm" icon={Save} loading={it.busy} disabled={!it.dirty} onClick={it.save}>
            保存
          </Button>
        }
      />
      <CardBody>
        {it.loading && !it.data ? (
          <Loading text="正在读取配置…" />
        ) : (
          <div className="stack">
            <JdPositionPanel it={it} />
            {it.error && <Alert tone="error">{it.error}</Alert>}
            {it.notice && <Alert tone="success">{it.notice}</Alert>}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/** 推广位管理：每个用户固定绑定一个推广位，订单按推广位精确关联用户 */
export function Adzones() {
  return (
    <div className="stack">
      <TaobaoAdzones />
      <JdPositions />
    </div>
  )
}
