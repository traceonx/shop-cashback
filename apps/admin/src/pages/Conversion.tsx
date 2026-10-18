import { useState } from 'react'
import { Copy, ExternalLink, Link2, Zap } from 'lucide-react'
import { api, type Row } from '../lib/api'
import { amount, errorText, type Notify } from '../lib/format'
import { Alert, Button, EmptyState, Modal, TextArea } from '../ui'
import { Thumb } from './shared'

/** 转链结果卡片（转链测试预览、转链记录详情共用） */
export function ConversionCard({ result }: { result: Row }) {
  return (
    <div className="convert-card">
      <div className="convert-card-head">
        <Thumb src={result.imageUrl} large />
        <div>
          <strong>{String(result.product)}</strong>
          {typeof result.shop === 'string' && result.shop && <small>店铺：{result.shop}（下单前请核对）</small>}
        </div>
      </div>
      <dl className="convert-prices">
        <div>
          <dt>售价</dt>
          <dd>{amount(result.price)}</dd>
        </div>
        <div>
          <dt>优惠券</dt>
          <dd>{result.coupon == null ? '—' : amount(result.coupon)}</dd>
        </div>
        <div>
          <dt>预计返现</dt>
          <dd className="text-success">{amount(result.rebate)}</dd>
        </div>
        <div>
          <dt>预计到手</dt>
          <dd className="text-primary">{amount(result.finalPrice)}</dd>
        </div>
      </dl>
      {typeof result.infoMessage === 'string' && result.infoMessage && <Alert tone="warning">{result.infoMessage}</Alert>}
      {typeof result.password === 'string' && result.password && <div className="convert-line">淘口令：{result.password}</div>}
      <a className="convert-line convert-link" href={String(result.promotionUrl)} target="_blank" rel="noopener noreferrer">
        <span>{String(result.promotionUrl)}</span>
        <ExternalLink size={14} />
      </a>
    </div>
  )
}

/** 转链测试弹窗：左侧输入，右侧预览用户收到的消息 */
export function Conversion({ onClose, notify }: { onClose: () => void; notify: Notify }) {
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Row>()

  async function run() {
    setBusy(true)
    setError('')
    setResult(undefined)
    try {
      setResult(await api<Row>('/promotions/convert', { method: 'POST', body: JSON.stringify({ content }) }))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(`${result.product}\n售价：${amount(result.price)}\n预计返现：${amount(result.rebate)}\n${result.promotionUrl}`)
      notify('已复制商品消息')
    } catch {
      setError('复制失败，请检查浏览器剪贴板权限')
    }
  }

  return (
    <Modal
      title="转链测试"
      subtitle="调用已配置的联盟接口，预览用户收到的消息"
      icon={Link2}
      size="lg"
      dismissible={!busy}
      onClose={onClose}
      footer={
        <>
          {result && (
            <Button variant="outlined" icon={Copy} onClick={copy}>
              复制消息
            </Button>
          )}
          <Button variant="primary" icon={Zap} loading={busy} disabled={!content.trim()} onClick={run}>
            生成推广链接
          </Button>
        </>
      }
    >
      <div className="convert-layout">
        <div className="stack">
          <TextArea
            label="商品链接或分享文案"
            autoFocus
            rows={8}
            maxLength={3000}
            placeholder="粘贴京东、淘宝 / 天猫商品链接或分享文案"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          {error && <Alert tone="error">{error}</Alert>}
        </div>
        <div className="convert-preview">
          {result ? <ConversionCard result={result} /> : <EmptyState icon={Link2} title="消息预览" description="生成后在这里预览转链结果" />}
        </div>
      </div>
    </Modal>
  )
}
