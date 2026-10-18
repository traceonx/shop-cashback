import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { api } from '../lib/api'
import { errorText } from '../lib/format'
import { Avatar, Card, Chip } from '../ui'

export type IntegrationKind = 'wecom' | 'jd' | 'taobao'
export type IntegrationField = { key: string; label: string; secret: boolean; value: string; configured: boolean }
export type IntegrationTest = { status: string; message: string; checkedAt: string }
export type IntegrationData = {
  kind: string
  configured: boolean
  fields: IntegrationField[]
  test: null | IntegrationTest
  callbackPath: string
}

export type TileStatus = 'ok' | 'pending' | 'empty'

const valuesOf = (d: IntegrationData) => Object.fromEntries(d.fields.map((f) => [f.key, f.value ?? '']))

/**
 * 渠道配置的读取 / 保存 / 测试。
 * summary：列表卡片用的概要（不含明文密钥）；details：打开配置弹窗时读取完整配置。
 */
export function useIntegration(kind: IntegrationKind) {
  const [data, setData] = useState<IntegrationData>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const fill = (d: IntegrationData) => {
    setData(d)
    setValues(valuesOf(d))
  }
  const run = async (task: () => Promise<void>) => {
    setError('')
    setNotice('')
    try {
      await task()
    } catch (e) {
      setError(errorText(e))
    }
  }
  const summary = useCallback(async () => {
    setLoading(true)
    await run(async () => fill(await api<IntegrationData>(`/integrations/${kind}`)))
    setLoading(false)
  }, [kind])
  const details = async () => {
    setLoading(true)
    await run(async () => fill(await api<IntegrationData>(`/integrations/${kind}/details`, { method: 'POST' })))
    setLoading(false)
  }
  const save = async () => {
    setBusy(true)
    await run(async () => {
      await api(`/integrations/${kind}`, { method: 'PUT', body: JSON.stringify(values) })
      fill(await api<IntegrationData>(`/integrations/${kind}/details`, { method: 'POST' }))
      setNotice('配置已保存')
    })
    setBusy(false)
  }
  const test = async () => {
    setBusy(true)
    await run(async () => {
      const r = await api<IntegrationTest>(`/integrations/${kind}/test`, { method: 'POST' })
      setData((d) => (d ? { ...d, test: r } : d))
      if (r.status === 'CONNECTED') setNotice(r.message)
      else setError(r.message)
    })
    setBusy(false)
  }
  useEffect(() => {
    void summary()
  }, [summary])

  const dirty = !!data && data.fields.some((f) => (values[f.key] ?? '') !== (f.value ?? ''))
  const set = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
    setNotice('')
  }
  const field = (key: string) => data?.fields.find((f) => f.key === key)
  const status: TileStatus = data?.test?.status === 'CONNECTED' ? 'ok' : data?.configured ? 'pending' : 'empty'
  return { data, values, set, field, dirty, loading, busy, error, notice, status, summary, details, save, test }
}

/** 渠道卡片：点击打开配置弹窗 */
export function ProviderTile({
  icon,
  name,
  description,
  status,
  loading,
  onClick,
  extra,
}: {
  icon: LucideIcon
  name: string
  description: string
  status: TileStatus
  loading?: boolean
  onClick: () => void
  extra?: ReactNode
}) {
  return (
    <Card className="provider-tile">
      <button type="button" onClick={onClick} disabled={loading}>
        <Avatar icon={icon} tone={status === 'ok' ? 'success' : status === 'pending' ? 'warning' : 'secondary'} size="lg" />
        <span className="provider-text">
          <strong>{name}</strong>
          <small>{description}</small>
        </span>
        <Chip tone={status === 'ok' ? 'success' : status === 'pending' ? 'warning' : 'secondary'} dot>
          {loading ? '读取中' : status === 'ok' ? '已连接' : status === 'pending' ? '待验证' : '未配置'}
        </Chip>
        <ChevronRight size={18} className="text-faint" />
      </button>
      {extra}
    </Card>
  )
}
