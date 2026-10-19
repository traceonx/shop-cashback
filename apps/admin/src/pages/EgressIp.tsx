import { useCallback, useEffect, useState } from 'react'
import { Copy, Globe, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { dateTime, errorText } from '../lib/format'
import { Alert, Button, Card, CardBody, Loading, Modal } from '../ui'

type Lookup = { ip: string | null; source: string | null; error: string | null }
type Egress = { direct: Lookup; proxy: (Lookup & { label: string }) | null; checkedAt: string }

function IpRow({ title, hint, value }: { title: string; hint: string; value: Lookup }) {
  return (
    <Card>
      <CardBody>
        <div className="egress-row">
          <div>
            <strong>{title}</strong>
            <small>{hint}</small>
          </div>
          {value.ip ? (
            <span className="egress-ip">
              <span className="text-mono">{value.ip}</span>
              <Button variant="text" size="sm" icon={Copy} onClick={() => navigator.clipboard?.writeText(value.ip!)}>
                复制
              </Button>
            </span>
          ) : (
            <span className="text-faint">查询失败</span>
          )}
        </div>
        {!value.ip && value.error && <small className="text-faint">{value.error}</small>}
      </CardBody>
    </Card>
  )
}

/** 出口 IP 查询：核对喵有券等接口的 IP 白名单 */
export function EgressIp({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Egress>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api<Egress>('/system/egress-ip'))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  return (
    <Modal
      title="出口 IP 查询"
      subtitle="服务器访问外部接口时对方看到的 IP，用于填写喵有券等 IP 白名单"
      icon={Globe}
      size="md"
      onClose={onClose}
      footerNote={data ? `查询于 ${dateTime(data.checkedAt)}` : undefined}
      footer={
        <Button variant="outlined" icon={RefreshCw} loading={loading} onClick={load}>
          重新查询
        </Button>
      }
    >
      {loading && !data ? (
        <Loading text="正在查询…" />
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : data ? (
        <div className="stack">
          <IpRow title="直连出口" hint="淘宝、京东官方接口及企业微信使用" value={data.direct} />
          {data.proxy ? (
            <IpRow title={`经代理出口（${data.proxy.label}）`} hint="喵有券接口使用；代理失败时会自动直连重试" value={data.proxy} />
          ) : (
            <Alert tone="info">未设置 PROXY_HOST，喵有券接口直连，白名单填写上面的直连出口 IP。</Alert>
          )}
          {data.proxy && (
            <Alert tone="info">
              经代理的结果取决于代理分流规则：IP 查询服务（ipw.cn 等）与 ecapi.cn 分到同一节点时，才等于喵有券看到的 IP。家用宽带直连出口 IP 会变，变了需要更新喵有券白名单。
            </Alert>
          )}
        </div>
      ) : null}
    </Modal>
  )
}
