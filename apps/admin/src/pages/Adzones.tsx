import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CircleDashed, Gauge, Layers, Pencil, ShoppingBag, Tag, UserCheck } from 'lucide-react'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'
import { Alert, Avatar, Button, Card, CardBody, CardHeader, Chip, EmptyState, Loading, Modal, Segmented, StatCard, Switch, Tabs, TextArea, type Tone } from '../ui'
import { useIntegration } from './integration'

/** 两个平台统一成一种推广位格子 */
type Slot = { id: string; user: { id: string; name: string } | null; boundAt: string | null; tag?: [Tone, string] }
type Filter = 'all' | 'bound' | 'free'
const filters: [Filter, string][] = [
  ['all', '全部'],
  ['bound', '已绑定'],
  ['free', '空闲'],
]

/** 统计 + 推广位格子；编辑推广位池放在弹窗里 */
function PositionBoard({
  it,
  title,
  icon,
  slots,
  free,
  poolSize,
  extraStat,
  warning,
  settings,
}: {
  it: ReturnType<typeof useIntegration>
  title: string
  icon: typeof Tag
  slots: Slot[] | undefined
  free: number
  poolSize: number
  extraStat?: { label: string; value: number }
  warning?: string
  /** 弹窗内容（推广位池输入等） */
  settings: ReactNode
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState(false)
  const bound = slots?.filter((s) => s.user).length ?? 0
  const shown = (slots ?? []).filter((s) => filter === 'all' || (filter === 'bound' ? !!s.user : !s.user))
  const close = () => {
    // 取消时还原未保存的修改
    for (const f of it.data?.fields ?? []) it.set(f.key, f.value ?? '')
    setEditing(false)
  }
  const save = async () => {
    if (await it.save()) setEditing(false)
  }
  if (it.loading && !it.data) return <Loading text="正在读取配置…" />
  return (
    <>
      <div className="stat-grid">
        <StatCard icon={Layers} tone="primary" label="推广位池" value={poolSize} unit="个" />
        <StatCard icon={UserCheck} tone="success" label="已绑定用户" value={bound} unit="个" />
        <StatCard icon={CircleDashed} tone={free <= 2 ? 'warning' : 'info'} label="空闲" value={free} unit="个" caption={free <= 2 ? '即将用完，请补充' : undefined} />
        {extraStat ? (
          <StatCard icon={Gauge} tone="secondary" label={extraStat.label} value={extraStat.value} unit="个" />
        ) : (
          <StatCard icon={Gauge} tone="secondary" label="使用率" value={poolSize ? Math.round((bound / poolSize) * 100) : 0} unit="%" />
        )}
      </div>
      {warning && <Alert tone="warning">{warning}</Alert>}
      {it.notice && !editing && <Alert tone="success">{it.notice}</Alert>}
      <Card>
        <CardHeader
          title={title}
          subtitle="用户首次转链时固定绑定一个空闲推广位，订单按推广位 ID 精确关联用户"
          icon={icon}
          actions={
            <>
              <Segmented items={filters} value={filter} onChange={setFilter} />
              <Button size="sm" icon={Pencil} onClick={() => setEditing(true)}>
                编辑推广位池
              </Button>
            </>
          }
        />
        <CardBody>
          {!slots?.length ? (
            <EmptyState
              icon={icon}
              title="还没有推广位"
              description="在联盟后台建好推广位后添加到推广位池，新用户转链时会自动绑定"
              action={
                <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>
                  添加推广位
                </Button>
              }
            />
          ) : !shown.length ? (
            <EmptyState icon={icon} title={filter === 'bound' ? '暂无已绑定的推广位' : '没有空闲推广位'} />
          ) : (
            <div className="position-grid">
              {shown.map((s) => (
                <div key={s.id} className={s.user ? 'position-tile is-bound' : 'position-tile'}>
                  <div className="position-tile-head">
                    <span className="position-id">{s.id}</span>
                    {s.tag ? <Chip tone={s.tag[0]}>{s.tag[1]}</Chip> : <Chip tone={s.user ? 'success' : 'secondary'} dot>{s.user ? '已绑定' : '空闲'}</Chip>}
                  </div>
                  {s.user ? (
                    <div className="position-user">
                      <Avatar text={s.user.name.slice(0, 1).toUpperCase()} size="sm" round />
                      <div>
                        <strong>{s.user.name}</strong>
                        <small>{s.boundAt ? `${dateTime(s.boundAt)} 绑定` : '已绑定'}</small>
                      </div>
                    </div>
                  ) : (
                    <div className="position-user is-empty">等待新用户绑定</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      {editing && (
        <Modal
          title="编辑推广位池"
          subtitle={title}
          icon={icon}
          size="md"
          dismissible={!it.busy}
          onClose={close}
          footer={
            <>
              <Button variant="text" disabled={it.busy} onClick={close}>
                取消
              </Button>
              <Button variant="primary" loading={it.busy} disabled={!it.dirty} onClick={() => void save()}>
                保存
              </Button>
            </>
          }
        >
          <div className="stack">
            {settings}
            {it.error && <Alert tone="error">{it.error}</Alert>}
          </div>
        </Modal>
      )}
    </>
  )
}

type JdBinding = { positionId: string; inPool: boolean; user: { id: string; name: string } | null; boundAt: string | null }
/** 京东：推广位池与绑定情况 */
function JdPositions() {
  const it = useIntegration('jd')
  const [data, setData] = useState<{ pool: JdBinding[]; free: number }>()
  useEffect(() => {
    void it.details()
  }, [])
  useEffect(() => {
    api<{ pool: JdBinding[]; free: number }>('/integrations/jd/positions').then(setData, () => setData(undefined))
  }, [it.data])
  const slots = data?.pool.map((b): Slot => ({ id: b.positionId, user: b.user, boundAt: b.boundAt, tag: b.inPool ? undefined : ['warning', '已不在池中'] }))
  const poolSize = data?.pool.filter((b) => b.inPool).length ?? 0
  return (
    <PositionBoard
      it={it}
      title="京东推广位"
      icon={Tag}
      slots={slots}
      free={data?.free ?? 0}
      poolSize={poolSize}
      warning={data && poolSize && !data.free ? '推广位池已用完：新用户将使用默认推广位，订单无法自动关联用户' : undefined}
      settings={
        <TextArea
          label="推广位 ID"
          hint="在京东联盟后台「推广管理 → 推广位」建好后填入，每行一个。池子用完时使用默认推广位，订单不自动关联用户；已绑定用户的推广位不能移除"
          rows={10}
          placeholder={'3100000001\n3100000002'}
          value={it.values.positionPool ?? ''}
          onChange={(e) => it.set('positionPool', e.target.value)}
        />
      }
    />
  )
}

type TbBinding = { adzone: string; pid: string | null; source: 'POOL' | 'CREATED'; user: { id: string; name: string } | null; boundAt: string | null }
/** 淘宝：每个用户独立推广位开关、推广位池与绑定情况 */
function TaobaoAdzones() {
  const it = useIntegration('taobao')
  const [data, setData] = useState<{ pool: TbBinding[]; created: TbBinding[]; free: number }>()
  useEffect(() => {
    void it.details()
  }, [])
  useEffect(() => {
    api<{ pool: TbBinding[]; created: TbBinding[]; free: number }>('/integrations/taobao/adzones').then(setData, () => setData(undefined))
  }, [it.data])
  const enabled = it.values.perUserAdzone !== 'false'
  const saved = it.field('perUserAdzone')?.value !== 'false'
  const slots = data && [...data.pool, ...data.created].map((b): Slot => ({ id: b.pid || b.adzone, user: b.user, boundAt: b.boundAt, tag: b.source === 'CREATED' ? ['info', '自动创建'] : undefined }))
  return (
    <PositionBoard
      it={it}
      title="淘宝推广位"
      icon={ShoppingBag}
      slots={slots}
      free={data?.free ?? 0}
      poolSize={data?.pool.length ?? 0}
      extraStat={{ label: '自动创建', value: data?.created.length ?? 0 }}
      warning={!saved ? '已关闭每个用户独立推广位：所有用户使用默认推广位转链，订单不按推广位关联用户' : undefined}
      settings={
        <>
          <Switch label="每个用户独立推广位" checked={enabled} onChange={(v) => it.set('perUserAdzone', v ? 'true' : 'false')} />
          <small className="text-faint">
            先从推广位池取未绑定的；池子用完且开启喵有券淘宝接入时自动创建（喵有券付费接口）；都不行时使用默认推广位。
          </small>
          {enabled && (
            <TextArea
              label="推广位 PID"
              hint="在淘宝联盟后台建好推广位后填入，每行一个 PID（mm_账号_网站_推广位），需与默认 PID 同一账号；已绑定用户的推广位不能移除"
              rows={10}
              placeholder={'mm_133091730_45556678_1234567890\nmm_133091730_45556678_1234567891'}
              value={it.values.adzonePool ?? ''}
              onChange={(e) => it.set('adzonePool', e.target.value)}
            />
          )}
        </>
      }
    />
  )
}

/** 推广位管理：顶部标签切换京东 / 淘宝，每个用户固定绑定一个推广位，订单按推广位精确关联用户 */
type Tab = 'jd' | 'taobao'
const tabs: { value: Tab; label: string; icon: typeof Tag }[] = [
  { value: 'jd', label: '京东联盟', icon: Tag },
  { value: 'taobao', label: '淘宝联盟', icon: ShoppingBag },
]
export function Adzones() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'taobao' ? 'taobao' : 'jd'
  return (
    <div className="stack">
      <Tabs items={tabs} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'jd' ? <JdPositions key="jd" /> : <TaobaoAdzones key="taobao" />}
    </div>
  )
}
