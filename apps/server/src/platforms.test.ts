import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jdPlugin, orderRows, jdOrderStatus, jdOrderAmounts, resolveJdSku } from './platforms/jd'
import { platform, platformForContent } from './platforms/registry'

test('商品查询兼容官方包装结构，空券信息仍可返回价格和佣金', async () => {
  const original = globalThis.fetch
  try {
    for (const wrapped of [false, true]) {
      globalThis.fetch = async (_url, options) => {
        const params = options!.body as URLSearchParams
        const method = params.get('method')!
        const item = {
          skuName: '测试商品', priceInfo: { price: '100.00', lowestCouponPrice: '80.00' },
          commissionInfo: { commission: '8.00' }, couponInfo: {},
          imageInfo: { imageList: wrapped ? { urlInfo: { url: 'https://img14.360buyimg.com/test.jpg' } } : [{ url: 'https://img14.360buyimg.com/test.jpg' }] },
        }
        if (method.endsWith('goods.query')) {
          const request = JSON.parse(params.get('360buy_param_json')!).goodsReqDTO
          assert.equal(request.sceneId, 1)
          assert.equal(request.keyword, 'https://u.jd.com/test')
        }
        const data = method.endsWith('goods.query') ? (wrapped ? { goodsResp: item } : [item]) : { clickURL: 'https://u.jd.com/test' }
        return new Response(JSON.stringify({ [`${method.replaceAll('.', '_')}_responce`]: { result: { code: 200, data } } }))
      }
      const result = await jdPlugin.convert({ appKey: 'test', appSecret: 'test', siteId: '1' }, 'https://item.jd.com/123.html')
      assert.equal(result.snapshot.price, 10000)
      assert.equal(result.snapshot.payablePrice, 8000)
      assert.equal(result.snapshot.commission, 800)
      assert.equal(result.snapshot.coupon, 0)
      assert.equal(result.snapshot.imageUrl, 'https://img14.360buyimg.com/test.jpg')
      assert.equal(result.snapshot.infoMessage, '')
    }
  } finally { globalThis.fetch = original }
})

test('短链识别商品且拒绝向非京东地址继续跳转', async () => {
  const original=globalThis.fetch
  let calls=0
  try {
    globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://item.m.jd.com/product/6088552.html'}})}
    assert.equal(await resolveJdSku('https://3.cn/test'),'6088552')
    assert.equal(calls,1)
    globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}
    assert.equal(await resolveJdSku('https://3.cn/test'),undefined)
    assert.equal(calls,2)
  } finally {globalThis.fetch=original}
})

test('商品金额和佣金按订单阶段映射，取消单返现佣金为零', () => {
  assert.deepEqual(
    jdOrderAmounts({ price: '278.40', skuNum: 2, validCode: 17, actualFee: '2.34', actualCosPrice: '77.90' }),
    { amount: 55680, commission: 234, commissionBase: 7790 },
  )
  assert.equal(jdOrderAmounts({ validCode: 16, actualFee: 0, estimateFee: '1.23' }).commission, 123)
  assert.equal(jdOrderAmounts({ validCode: 3, estimateFee: '1.23' }).commission, 0)
  assert.equal(jdOrderAmounts({}).amount, null)
})

test('京东交易状态与返现归属分开，取消单不得显示待归属', () => {
  assert.equal(jdOrderStatus('3'), 'CANCELLED')
  assert.equal(jdOrderStatus('15'), 'CREATED')
  assert.equal(jdOrderStatus('16'), 'PAID')
  assert.equal(jdOrderStatus('17'), 'COMPLETED')
  assert.equal(jdOrderStatus('999'), 'UNATTRIBUTED')
})

test('插件注册只暴露已实现的平台；链接不能绕过平台白名单', () => {
  assert.equal(platform('jd'), jdPlugin)
  assert.throws(() => platform('taobao'))
  assert.throws(() => platformForContent('https://item.jd.com.evil.test/1.html'))
  assert.equal(platformForContent('https://item.jd.com/123.html').plugin.id, 'jd')
  assert.equal(jdPlugin.configured({ appKey: 'test', appSecret: 'test' }), true)
})
test('成功响应无 data 是空订单，异常结构不能伪装为空', () => {
  assert.deepEqual(orderRows({}), [])
  assert.deepEqual(orderRows({ data: null, hasMore: false }), [])
  assert.throws(() => orderRows({ data: {} }))
  assert.throws(() => orderRows({ hasMore: true }))
})
test('京东插件请求签名与分页保留、长订单号与金额规范化', async () => {
  const original = globalThis.fetch
  let call = 0
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.jd.com/routerjson')
    const params = options!.body as URLSearchParams
    assert.equal(params.get('method'), 'jd.union.open.order.row.query')
    assert.match(params.get('sign')!, /^[A-F0-9]{32}$/)
    const req = JSON.parse(params.get('360buy_param_json')!).orderReq
    assert.equal(req.pageIndex, 2)
    assert.equal(req.type, 1)
    call++
    return new Response(
      JSON.stringify({
        jd_union_open_order_row_query_responce: {
          queryResult:
            '{"code":200,"hasMore":true,"data":[{"id":"row-1","orderId":9007199254740993101,"skuId":"1","skuName":"isolated","orderTime":"2026-10-17 00:00:00","finishTime":0,"estimateCosPrice":"10.10","estimateFee":"1.01"}]}',
        },
      }),
    )
  }
  try {
    const result = await jdPlugin.queryOrders(
      { appKey: 'test', appSecret: 'test' },
      { from: new Date('2026-10-16T16:00:00Z'), until: new Date('2026-10-16T17:00:00Z'), page: 2, type: 1 },
    )
    assert.equal(result.hasMore, true)
    assert.equal(result.rows[0].orderId, '9007199254740993101')
    assert.equal(result.rows[0].commissionCents, 101)
    assert.equal(result.rows[0].completedAt, null)
    assert.equal(call, 1)
  } finally {
    globalThis.fetch = original
  }
})
