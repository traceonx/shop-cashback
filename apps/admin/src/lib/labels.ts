import type { Tone } from '../ui/Card'

const labels: Record<string, string> = {
  SUCCESS: '转链成功',
  FAILED: '转链失败',
  CREATED: '待付款',
  PAID: '已付款',
  SETTLED: '已结算',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  UNATTRIBUTED: '待核实归属',
  PENDING_REVIEW: '待审核',
  PENDING_PAYMENT: '待打款',
  REJECTED: '已拒绝',
  ACTIVE: '正常',
  DISABLED: '已禁用',
}

export const statusLabel = (value: string) => labels[value] || value

export const statusTone = (value: string): Tone =>
  ['SUCCESS', 'SETTLED', 'COMPLETED', 'ACTIVE', 'PAID'].includes(value)
    ? 'success'
    : ['FAILED', 'REJECTED', 'DISABLED'].includes(value)
      ? 'error'
      : value === 'CANCELLED'
        ? 'secondary'
        : ['PENDING_REVIEW', 'PENDING_PAYMENT', 'UNATTRIBUTED'].includes(value)
          ? 'warning'
          : 'primary'
