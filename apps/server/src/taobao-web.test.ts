import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyWebResult, fallbackAllowed, mergeTaobaoRaw, validateCookies, webConversion, WebError, webOrder, webResponse, type WebIncident } from './platforms/taobao/web-core'

test('网页登录：网络、验证、限流与明确失效分开；未知 HTML 不误报失效', () => {
  for (const [status, text, kind] of [
    [429, '', 'LIMITED'], [403, '', 'VERIFY'], [503, '', 'NETWORK'], [200, '<html>login</html>', 'FORMAT'],
    [200, '{"success":false,"bizErrorCode":"NOT_LOGIN"}', 'EXPIRED'],
    [200, '{"success":true,"data":null}', 'BUSINESS'],
  ] as const) assert.throws(() => webResponse(status, text), e => e instanceof WebError && e.kind === kind)
  assert.deepEqual(webResponse(200, '{"success":true,"data":{"result":[]}}'), { result: [] })
})
test('失效事件：首次未登录不提醒；连续失效一次；恢复后允许下一次提醒', () => {
  const s: WebIncident = { state: 'PENDING' }
  applyWebResult(s, 'EXPIRED', 1, 'a')
  assert.equal(s.incident, undefined)
  applyWebResult(s, undefined, 2, 'b')
  applyWebResult(s, 'NETWORK', 3, 'c')
  assert.equal(s.incident, undefined)
  applyWebResult(s, 'EXPIRED', 4, 'd')
  s.notified = true
  applyWebResult(s, 'EXPIRED', 5, 'e')
  assert.equal(s.incident, 'd'); assert.equal(s.notified, true); assert.equal(s.expiredAt, 4)
  const persisted = JSON.parse(JSON.stringify(s))
  applyWebResult(persisted, 'EXPIRED', 6, 'f')
  assert.equal(persisted.notified, true)
  applyWebResult(s, undefined, 7, 'g')
  applyWebResult(s, 'EXPIRED', 8, 'h')
  assert.equal(s.incident, 'h'); assert.equal(s.notified, false)
})
test('转链：佣金率单位正确，价格不重复减券，不猜返现金额', () => {
  const r = webConversion({
    itemId: '716309468486', itemName: '口红', promotionPrice: '93', calTkRate: 9.6e2,
    shortLinkurl: 'https://s.click.taobao.com/regular', taoToken: 'regular',
    couponAmount: 39, couponRemainCount: 1, couponEffectiveStartTime: '1', couponEffectiveEndTime: '1000',
    couponShortLinkUrl: 'https://s.click.taobao.com/coupon', couponLinkTaoToken: 'coupon',
  }, 500)
  assert.equal(r.link, 'https://s.click.taobao.com/coupon')
  assert.equal(r.snapshot.password, 'coupon'); assert.equal(r.snapshot.price, 9300); assert.equal(r.snapshot.coupon, 3900)
  assert.equal(r.snapshot.payablePrice, null); assert.equal(r.snapshot.commission, null)
  assert.match(r.snapshot.infoMessage!, /9.6%/)
  const noCoupon = webConversion({ shortLinkurl: 'https://s.click.taobao.com/regular', calTkRate: 270 })
  assert.equal(noCoupon.snapshot.coupon, null); assert.match(noCoupon.snapshot.infoMessage!, /2.7%/)
})
test('网页订单：长整数不丢精度，推广位映射，与官方去重主键一致', () => {
  const r = webResponse(200, '{"success":true,"data":{"result":[{"tradeParentId":2938475610293847561,"tradeId":2938475610293847562,"adzoneId":116331050369,"tkCreateTime":"2026-10-20 12:00:00","alipayTotalPrice":"8","pubSharePreFee":"0.21","tkStatus":12}]}}')
  const o = webOrder(r.result[0])
  assert.equal(o.orderId, '2938475610293847561'); assert.equal(o.lineId, '2938475610293847562')
  assert.equal(o.trackingCode, '116331050369'); assert.equal(o.commissionCents, 21)
  assert.equal((o.raw as any)._source, 'taobao-web')
})
test('跨源合并保留缺失字段，零佣金和取消状态仍可覆盖', () => {
  assert.deepEqual(mergeTaobaoRaw({ item_id: 'x', adzone_id: '1234', pub_share_pre_fee: '10', tk_status: 12 },
    { item_id: '', adzone_id: null, pub_share_pre_fee: 0, tk_status: 13 }),
  { item_id: 'x', adzone_id: '1234', pub_share_pre_fee: 0, tk_status: 13 })
})
test('Cookie 限定域名路径并选择最长路径，拒绝头注入', () => {
  const cookie = (name: string, value: string, path = '/') => ({ name, value, path, domain: '.alimama.com' })
  assert.equal(validateCookies([cookie('_tb_token_', 'old'), cookie('_tb_token_', 'new', '/openapi/'), cookie('session', 'yes')]), '_tb_token_=new; session=yes')
  assert.throws(() => validateCookies([cookie('_tb_token_', 'x\r\nbad')]))
  assert.throws(() => validateCookies([{ ...cookie('_tb_token_', 'x'), domain: '.taobao.com' }]))
})
test('业务无结果不触发网页备用，权限和网络错误可以备用', () => {
  assert.equal(fallbackAllowed(new Error('物料搜索未找到该商品')), false)
  assert.equal(fallbackAllowed(new Error('商品同名有多家店铺')), false)
  assert.equal(fallbackAllowed({ kind: 'PERMISSION' }), true)
  assert.equal(fallbackAllowed(new Error('fetch failed')), true)
  assert.equal(fallbackAllowed({ kind: 'FORMAT' }), false)
})
