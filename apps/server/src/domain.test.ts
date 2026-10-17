import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractJdUrl, rebateCents, transitionWithdrawal, type Withdrawal } from './domain'
const fixture = () => ({
  w: {
    id: '1',
    user: 'a',
    userId: 'u1',
    amount: 2000,
    status: 'PENDING_REVIEW',
    createdAt: '',
    note: '',
    proof: '',
  } as Withdrawal,
  wallet: { available: 3000, frozen: 2000, withdrawn: 0 },
})
test('审核不扣款；确认凭证后扣冻结余额；重复操作不重复扣款', () => {
  const { w, wallet } = fixture()
  transitionWithdrawal(w, wallet, 'approve', '', '')
  assert.equal(wallet.frozen, 2000)
  assert.equal(w.status, 'PENDING_PAYMENT')
  assert.throws(() => transitionWithdrawal(w, wallet, 'confirm-payment', '', ''))
  transitionWithdrawal(w, wallet, 'confirm-payment', '', 'receipt')
  assert.equal(wallet.frozen, 0)
  assert.equal(wallet.withdrawn, 2000)
  assert.throws(() => transitionWithdrawal(w, wallet, 'confirm-payment', '', 'receipt'))
  assert.equal(wallet.withdrawn, 2000)
})
test('拒绝必须有原因且仅解冻一次', () => {
  const { w, wallet } = fixture()
  assert.throws(() => transitionWithdrawal(w, wallet, 'reject', '', ''))
  transitionWithdrawal(w, wallet, 'reject', '资料不完整', '')
  assert.equal(wallet.available, 5000)
  assert.equal(wallet.frozen, 0)
  assert.throws(() => transitionWithdrawal(w, wallet, 'reject', '重复', ''))
  assert.equal(wallet.available, 5000)
})
test('不允许跳过审核确认打款', () => {
  const { w, wallet } = fixture()
  assert.throws(() => transitionWithdrawal(w, wallet, 'confirm-payment', '', 'proof'))
  assert.equal(wallet.frozen, 2000)
})
test('金额使用整数分和基点，向下取整', () => {
  assert.equal(rebateCents(5000, 7000), 3500)
  assert.equal(rebateCents(101, 7000), 70)
  assert.throws(() => rebateCents(1.5, 7000))
  assert.throws(() => rebateCents(100, 10001))
})
test('严格链接白名单，拒绝内网、伪域名及用户信息', () => {
  assert.equal(extractJdUrl('京东商品 https://3.cn/abc'), 'https://3.cn/abc')
  for (const u of [
    'https://127.0.0.1/x',
    'https://item.jd.com.evil.com/a',
    'http://item.jd.com/a',
    'https://a@item.jd.com/a',
    'https://item.jd.com:8080/a',
  ])
    assert.throws(() => extractJdUrl(u))
})
