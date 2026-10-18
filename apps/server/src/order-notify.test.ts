import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderNews, splitTitle } from './wecom'

test('拆分商品标题末尾的【标签】', () => {
  assert.deepEqual(splitTitle('皇家猫粮 室内老年猫粮 3.5KG【宠物金选】'), { name: '皇家猫粮 室内老年猫粮 3.5KG', tag: '宠物金选' })
  assert.deepEqual(splitTitle('普通商品'), { name: '普通商品', tag: '' })
})

test('订单通知用图文消息：带商品图与累计返利，金额为 0 时不显示金额', () => {
  const base = { userId: 'u', platform: 'jd', title: '皇家猫粮【宠物金选】', amountCents: 0, commissionCents: 886 }
  const news = orderNews({ ...base, kind: 'created', imageUrl: 'https://img/1.jpg', url: 'https://item.jd.com/1.html' }, 620, 620)
  assert.equal(news.title, '✅ 下单成功，已记录返利')
  assert.equal(news.picurl, 'https://img/1.jpg')
  assert.equal(news.url, 'https://item.jd.com/1.html')
  assert.match(news.description, /本单返现：¥6\.20/)
  assert.match(news.description, /累计返利：¥6\.20/)
  assert.ok(!news.description.includes('金额'))
  assert.ok(!news.description.includes('以联盟结算为准'))

  const cancelled = orderNews({ ...base, kind: 'cancelled' }, 620, 0)
  assert.equal(cancelled.title, '❌ 订单已取消，本单不产生返现')
  assert.match(cancelled.description, /本单返现：¥0\.00/)
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
