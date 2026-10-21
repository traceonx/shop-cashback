import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderNews, splitTitle } from './wecom'
import { orderEventKind } from './order-sync'

test('拆分商品标题末尾的【标签】', () => {
  assert.deepEqual(splitTitle('皇家猫粮 室内老年猫粮 3.5KG【宠物金选】'), { name: '皇家猫粮 室内老年猫粮 3.5KG', tag: '宠物金选' })
  assert.deepEqual(splitTitle('普通商品'), { name: '普通商品', tag: '' })
})

test('订单通知用图文消息：下单显示付款金额与本单返现，取消只显示累计返利', () => {
  const base = { userId: 'u', platform: 'jd', title: '皇家猫粮【宠物金选】', amountCents: 0, commissionCents: 886 }
  const news = orderNews({ ...base, kind: 'created', imageUrl: 'https://img/1.jpg', url: 'https://item.jd.com/1.html' }, 620, 620)
  assert.equal(news.title, '✅ 下单成功，已记录返利')
  assert.equal(news.picurl, 'https://img/1.jpg')
  assert.equal(news.url, 'https://item.jd.com/1.html')
  assert.match(news.description, /本单返现：¥6\.20/)
  assert.match(news.description, /累计返利：¥6\.20/)
  assert.ok(!news.description.includes('付款金额'))
  const paid = orderNews({ ...base, amountCents: 2990, kind: 'created' }, 620, 620)
  assert.match(paid.description, /付款金额：¥29\.90\n本单返现：¥6\.20/)
  assert.ok(!news.description.includes('以联盟结算为准'))

  const cancelled = orderNews({ ...base, amountCents: 2990, kind: 'cancelled' }, 620, 0)
  assert.equal(cancelled.title, '❌ 订单已取消，本单不产生返现')
  assert.ok(!cancelled.description.includes('付款金额'))
  assert.ok(!cancelled.description.includes('本单返现'))
  assert.match(cancelled.description, /累计返利：¥0\.00/)
  assert.equal(cancelled.picurl, undefined)
})

test('我的返现账户文本：图标 + 对齐金额', async () => {
  const { accountText } = await import('./wecom')
  const text = accountText({ available: 0, pending: 620, frozen: 0, withdrawn: 12345 })
  assert.equal(
    text,
    ['💼 我的返现账户', '────────────', '💰 可提现　  ¥0.00', '📄 待结算　  ¥6.20', '❄️ 冻结　　  ¥0.00', '📊 累计提现  ¥123.45'].join('\n'),
  )
})

test('待付款不通知，付款后才算下单成功', () => {
  assert.equal(orderEventKind(undefined, 'CREATED'), null)
  assert.equal(orderEventKind('CREATED', 'PAID'), 'created')
  assert.equal(orderEventKind(undefined, 'PAID'), 'created')
  assert.equal(orderEventKind('PAID', 'PAID'), null)
  assert.equal(orderEventKind('PAID', 'COMPLETED'), 'completed')
  assert.equal(orderEventKind('CREATED', 'CANCELLED'), null)
  assert.equal(orderEventKind(undefined, 'CANCELLED'), null)
  assert.equal(orderEventKind('PAID', 'CANCELLED'), 'cancelled')
})

test('京东拆单：父单「无效-拆单」不算取消也不通知，同一笔购买的「下单成功」按商品与下单时间去重', async () => {
  const { jdOrderStatus, jdOrderAmounts, jdOrderSettlement } = await import('./platforms/jd')
  const { purchaseKey } = await import('./order-sync')
  assert.equal(jdOrderStatus('2'), 'INVALID')
  assert.equal(jdOrderStatus('3'), 'CANCELLED')
  assert.equal(jdOrderStatus('13'), 'CANCELLED')
  assert.equal(jdOrderStatus('16'), 'PAID')
  assert.equal(jdOrderStatus('99'), 'UNATTRIBUTED')
  assert.equal(jdOrderAmounts({ validCode: 2, estimateFee: '1.91' }).commission, 0)
  assert.equal(jdOrderSettlement({ validCode: 2 }).state, 'INVALID')
  assert.equal(orderEventKind('PAID', 'INVALID'), null)
  assert.equal(orderEventKind(undefined, 'INVALID'), null)
  const at = new Date('2026-10-21T04:25:31Z')
  assert.equal(purchaseKey('jd', 'u', '100', at), purchaseKey('jd', 'u', '100', new Date(at.getTime())))
  assert.notEqual(purchaseKey('jd', 'u', '100', at), purchaseKey('jd', 'u', '101', at))
})
