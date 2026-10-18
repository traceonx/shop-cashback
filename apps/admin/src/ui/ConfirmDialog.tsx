import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Modal'

/** 确认弹窗（替代浏览器原生 confirm） */
export function ConfirmDialog({
  title,
  children,
  confirmText = '确定',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      icon={CircleAlert}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outlined" onClick={onCancel}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="text-muted">{children}</div>
    </Modal>
  )
}
