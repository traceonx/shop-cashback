import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTaobaoOwner, normTitle } from './attribution-taobao'

const title = 'BOLON暴龙近视眼镜框商务眉架男金丝钛镜框斯文可配度数女BT6026'
const rec = (userId: string, snap: Record<string, unknown>) => ({ userId, productSnapshot: snap })

test('只有一人转过且商品 ID 或完整标题一致时关联', () => {
  assert.equal(decideTaobaoOwner([rec('A', { sku: 'id-1', product: '别的标题' })], 'id-1', title), 'A')
  assert.equal(decideTaobaoOwner([rec('A', { sku: 'id-x', product: title })], 'id-2', title), 'A')
  assert.equal(decideTaobaoOwner([rec('A', { product: `【双11】${title}` })], 'id-2', title), 'A')
  assert.equal(decideTaobaoOwner([rec('A', { sku: 'id-1', product: title }), rec('A', { sku: 'id-1', product: title })], 'id-1', title), 'A')
})

test('A、B 都可能转过同一商品时不关联（含 ID 不同、标题包含、商品信息缺失）', () => {
  assert.equal(decideTaobaoOwner([rec('A', { sku: 'id-1', product: title }), rec('B', { sku: 'id-1', product: title })], 'id-1', title), null)
  // B 的记录 ID 被联盟重新生成、但标题一致
  assert.equal(decideTaobaoOwner([rec('A', { sku: 'id-1', product: title }), rec('B', { sku: 'id-9', product: title })], 'id-1', title), null)
  // B 只存了截短的标题（互相包含）
  assert.equal(decideTaobaoOwner([rec('A', { sku: 'id-1', product: title }), rec('B', { product: 'BOLON暴龙近视眼镜框商务眉架男' })], 'id-1', title), null)
  // B 的转链没拿到商品信息，无法排除
  assert.equal(decideTaobaoOwner([rec('A', { sku: 'id-1', product: title }), rec('B', { product: '淘宝商品' })], 'id-1', title), null)
})

test('只有宽松匹配、没有精确匹配时不关联；无关商品不影响', () => {
  assert.equal(decideTaobaoOwner([rec('A', { product: 'BOLON暴龙近视眼镜框商务眉架男' })], 'id-1', title), null)
  assert.equal(decideTaobaoOwner([rec('A', { sku: 'id-1', product: title }), rec('B', { sku: 'x', product: '南孚7号碱性电池6粒' })], 'id-1', title), 'A')
  assert.equal(decideTaobaoOwner([], 'id-1', title), null)
  assert.equal(normTitle('【李佳琦】嫚熙 月子服 (女)'), '嫚熙月子服女')
})
