import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTaobaoOrder, orderSourceOf, queryTaobaoOrders, taobaoOrderAmounts, TaobaoOrderError } from './platforms/taobao/orders'
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
  // 接口没有确认收货时间；结算时间与完成时间不混用
  assert.equal(normalizeTaobaoOrder({ ...raw, tk_status: 3, tk_earning_time: '2026-10-25 10:00:00' }).completedAt, null)
  // 计佣金额：结算后按结算金额 pay_price
  assert.equal(taobaoOrderAmounts({ ...raw, tk_status: 3, pay_price: '380.00' }).commissionBase, 38000)
  assert.equal(taobaoOrderAmounts(raw).commissionBase, 38597)
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
    assert.equal(p1.position, 'POS1')
    // 第 2 页的位点由同步任务从游标传入（持久化，重启可恢复）
    const p2 = await queryTaobaoOrders(c, { ...req, page: 2, position: p1.position })
    assert.equal(p2.hasMore, false)
    assert.equal(seen[0].get('query_type'), '4')
    // 向前重叠 1 分钟
    assert.equal(seen[0].get('start_time'), '2026-10-19 13:59:00')
    assert.equal(seen[0].get('position_index'), null)
    assert.equal(seen[1].get('position_index'), 'POS1')
  } finally {
    globalThis.fetch = original
  }
})

const req = { from: new Date('2026-10-19T06:00:00Z'), until: new Date('2026-10-19T06:20:00Z'), type: 1 as const, page: 1 }
const okBody = (method: string) =>
  JSON.stringify({ [`${method.replace(/^taobao\./, '').replaceAll('.', '_')}_response`]: { data: { has_next: false, results: { publisher_order_dto: [order] } } } })

test('限流与超时有上限地退避重试；响应格式异常不当作零订单', async () => {
  const original = globalThis.fetch
  const waits: number[] = []
  const sleep = async (ms: number) => void waits.push(ms)
  try {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return calls < 3
        ? new Response(JSON.stringify({ error_response: { code: 7, msg: 'App Call Limited', sub_code: 'accesscontrol.limited-by-app-access-count' } }))
        : new Response(okBody('taobao.tbk.order.details.get'))
    }
    const r = await queryTaobaoOrders({ ...c, orderSource: 'official' }, req, { sleep })
    assert.equal(r.rows.length, 1)
    assert.deepEqual(waits, [1000, 3000])
    calls = 0
    globalThis.fetch = async () => {
      calls++
      throw new Error('timeout')
    }
    await assert.rejects(queryTaobaoOrders({ ...c, orderSource: 'official' }, req, { sleep }), (e: unknown) => e instanceof TaobaoOrderError && e.kind === 'TIMEOUT')
    assert.equal(calls, 3)
    globalThis.fetch = async () => new Response(JSON.stringify({ tbk_order_details_get_response: {} }))
    await assert.rejects(queryTaobaoOrders({ ...c, orderSource: 'official' }, req, { sleep }), (e: unknown) => e instanceof TaobaoOrderError && e.kind === 'FORMAT')
    globalThis.fetch = async () => new Response(JSON.stringify({ tbk_order_details_get_response: { data: { has_next: true, results: { publisher_order_dto: [order] } } } }))
    await assert.rejects(queryTaobaoOrders({ ...c, orderSource: 'official' }, req, { sleep }), /翻页位点/)
    // 成功但无订单：data 存在、无 results 才是零订单
    globalThis.fetch = async () => new Response(JSON.stringify({ tbk_order_details_get_response: { data: { has_next: false } } }))
    assert.equal((await queryTaobaoOrders({ ...c, orderSource: 'official' }, req, { sleep })).rows.length, 0)
    await assert.rejects(queryTaobaoOrders({ ...c, orderSource: 'official' }, { ...req, page: 2 }, { sleep }), /翻页位点丢失/)
  } finally {
    globalThis.fetch = original
  }
})

test('数据源选择：明确选择优先；旧配置按一次性推断；切换数据源订单唯一键不变', async () => {
  assert.equal(orderSourceOf({ orderSource: 'official-sc' }, true), 'official')
  assert.equal(orderSourceOf({}, true), 'ecapi')
  assert.equal(orderSourceOf({}, false), 'official')
  assert.equal(orderSourceOf({ orderSource: 'bogus' }, false), 'official')
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (u) => {
      if (String(u).includes('ecapi.cn')) return new Response(JSON.stringify({ code: 200, data: { has_next: false, list: [order] } }))
      return new Response(okBody('taobao.tbk.order.details.get'))
    }
    const viaEcapi = await queryTaobaoOrders({ ...c, orderSource: 'ecapi' }, req, { ecapi: async () => ({ apiKey: 'ak', tbname: 'tb' }) })
    const viaOfficial = await queryTaobaoOrders({ ...c, orderSource: 'official' }, req)
    // 入库唯一键（平台、账号、订单号、子订单号）与数据源无关
    assert.deepEqual([viaEcapi.rows[0].orderId, viaEcapi.rows[0].lineId], [viaOfficial.rows[0].orderId, viaOfficial.rows[0].lineId])
    await assert.rejects(queryTaobaoOrders({ ...c, orderSource: 'ecapi' }, req, { ecapi: async () => null }), /喵有券/)
  } finally {
    globalThis.fetch = original
  }
})
