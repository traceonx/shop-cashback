import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTaobaoOrder, queryTaobaoOrders, taobaoOrderAmounts } from './platforms/taobao/orders'
import { taobaoPlugin } from './platforms/taobao'

const c = { appKey: 'k', appSecret: 's', pid: 'mm_1_2_3', adzoneId: '3' }
const order = {
  trade_parent_id: '2938475610293847561',
  trade_id: '2938475610293847562',
  item_id: 'oQa8py-NEWID',
  item_title: 'FILA斐乐男鞋复古跑步鞋',
  item_num: 1,
  item_price: '458.00',
  alipay_total_price: '385.97',
  pub_share_pre_fee: '3.03',
  tk_status: 12,
  tk_create_time: '2026-10-19 15:20:01',
  item_img: '//img.alicdn.com/bao/a.jpg',
}

test('淘宝订单规范化：长订单号原样保留、北京时间、状态与佣金口径', () => {
  const raw = order
  const o = normalizeTaobaoOrder(raw)
  assert.equal(o.orderId, '2938475610293847561')
  assert.equal(o.lineId, '2938475610293847562')
  assert.equal(o.placedAt.toISOString(), '2026-10-19T07:20:01.000Z')
  assert.equal(o.status, 'PAID')
  assert.equal(o.commissionCents, 303)
  assert.equal(o.commissionBaseCents, 38597)
  assert.equal(o.trackingCode, null)
  assert.equal(taobaoPlugin.orderImage(raw), 'https://img.alicdn.com/bao/a.jpg')
  assert.equal(taobaoOrderAmounts({ ...raw, tk_status: 13 }).commission, 0)
  assert.equal(taobaoOrderAmounts({ ...raw, tk_status: 3, pub_share_fee: '2.80' }).commission, 280)
  assert.equal(taobaoPlugin.orderStatus('3'), 'COMPLETED')
  assert.equal(taobaoPlugin.orderSync, undefined)
})

test('官方订单查询：按更新时间查询、翻页回传位点', async () => {
  const original = globalThis.fetch
  const seen: URLSearchParams[] = []
  try {
    globalThis.fetch = async (_url, init) => {
      const p = init!.body as URLSearchParams
      seen.push(p)
      assert.equal(p.get('method'), 'taobao.tbk.order.details.get')
      const page = Number(p.get('page_no'))
      const body = `{"tbk_order_details_get_response":{"data":{"has_next":${page === 1},"position_index":"POS${page}","results":{"publisher_order_dto":[${JSON.stringify({ ...order, tk_status: 14 }).replace(/"(trade_parent_id|trade_id)":"(\d+)"/g, '"$1":$2')}]}}}}`
      return new Response(body)
    }
    const req = { from: new Date('2026-10-19T06:00:00Z'), until: new Date('2026-10-19T07:00:00Z'), type: 3 as const }
    const p1 = await queryTaobaoOrders(c, { ...req, page: 1 })
    assert.equal(p1.hasMore, true)
    assert.equal(p1.rows[0].orderId, '2938475610293847561')
    assert.equal(p1.rows[0].status, 'COMPLETED')
    const p2 = await queryTaobaoOrders(c, { ...req, page: 2 })
    assert.equal(p2.hasMore, false)
    assert.equal(seen[0].get('query_type'), '4')
    assert.equal(seen[0].get('start_time'), '2026-10-19 14:00:00')
    assert.equal(seen[0].get('position_index'), null)
    assert.equal(seen[1].get('position_index'), 'POS1')
  } finally {
    globalThis.fetch = original
  }
})
