import { randomUUID } from 'node:crypto'

export type WithdrawalStatus = 'PENDING_REVIEW' | 'PENDING_PAYMENT' | 'COMPLETED' | 'REJECTED'
export interface Withdrawal {
  id: string
  user: string
  userId: string
  amount: number
  status: WithdrawalStatus
  createdAt: string
  note: string
  proof: string
}
export interface Wallet {
  available: number
  frozen: number
  withdrawn: number
}
export function transitionWithdrawal(w: Withdrawal, wallet: Wallet, action: string, note: string, proof: string) {
  if (action === 'approve' && w.status === 'PENDING_REVIEW') w.status = 'PENDING_PAYMENT'
  else if (action === 'reject' && w.status === 'PENDING_REVIEW') {
    if (!note.trim()) throw new Error('请填写拒绝原因')
    if (wallet.frozen < w.amount) throw new Error('冻结余额不足')
    wallet.frozen -= w.amount
    wallet.available += w.amount
    w.status = 'REJECTED'
  } else if (action === 'confirm-payment' && w.status === 'PENDING_PAYMENT') {
    if (!proof.trim()) throw new Error('请填写人工打款凭证编号')
    if (wallet.frozen < w.amount) throw new Error('冻结余额不足')
    wallet.frozen -= w.amount
    wallet.withdrawn += w.amount
    w.status = 'COMPLETED'
    w.proof = proof
  } else throw new Error('当前状态不允许此操作，请刷新后重试')
  w.note = note
}
export function extractJdUrl(text: string): string {
  const value = text.match(/https:\/\/[^\s<>"'，。]+/i)?.[0]
  if (!value) throw new Error('请输入以 https:// 开头的京东商品链接')
  const url = new URL(value)
  if (!['item.jd.com', '3.cn', 'u.jd.com'].includes(url.hostname) || url.port || url.username || url.password)
    throw new Error('仅支持 item.jd.com、3.cn 和 u.jd.com 的 HTTPS 链接')
  return url.toString()
}
export function rebateCents(commission: number, basisPoints: number): number {
  if (
    !Number.isSafeInteger(commission) ||
    commission < 0 ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10000
  )
    throw new Error('金额或比例无效')
  return Number((BigInt(commission) * BigInt(basisPoints)) / 10000n)
}
export const uid = () => randomUUID()
