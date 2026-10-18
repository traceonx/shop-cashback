import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderCard, splitTitle } from './wecom'

test('拆分商品标题末尾的【标签】', () => {
  assert.deepEqual(splitTitle('皇家猫粮 室内老年猫粮 3.5KG【宠物金选】'), { name: '皇家猫粮 室内老年猫粮 3.5KG', tag: '宠物金选' })
  assert.deepEqual(splitTitle('普通商品'), { name: '普通商品', tag: '' })
})

test('订单通知卡片：有图用图文卡片、显示累计返利，金额为 0 时不显示金额', () => {
  const base = { userId: 'u', platform: 'jd', title: '皇家猫粮【宠物金选】', amountCents: 0, commissionCents: 886 }
  const card = orderCard({ ...base, kind: 'created', imageUrl: 'https://img/1.jpg', url: 'https://item.jd.com/1.html' }, 620, 620).template_card as any
  assert.equal(card.card_type, 'news_notice')
  assert.equal(card.main_title.title, '✅ 下单成功，已记录返利')
  assert.equal(card.image_text_area.desc, '宠物金选')
  assert.equal(card.vertical_content_list[0].title, '累计返利 ¥6.20')
  assert.ok(!card.horizontal_content_list.some((r: any) => r.keyname === '金额'))
  assert.ok(!JSON.stringify(card).includes('以联盟结算为准'))

  const cancelled = orderCard({ ...base, kind: 'cancelled' }, 620, 0).template_card as any
  assert.equal(cancelled.card_type, 'text_notice')
  assert.equal(cancelled.emphasis_content.title, '¥0.00')
  assert.equal(cancelled.horizontal_content_list.find((r: any) => r.keyname === '本单返现').value, '¥0.00')
})
