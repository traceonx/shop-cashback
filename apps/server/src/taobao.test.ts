import { test } from 'node:test'
import assert from 'node:assert/strict'
import { topSign, extractTaobaoUrl, resolveItemId, parseItemDetail, parseConvert, taobaoPlugin } from './platforms/taobao'
import { platformForContent } from './platforms/registry'

test('TOP MD5 签名与官方示例一致', () => {
  const params = { app_key: '12345678', fields: 'num_iid,title,nick,price,num', format: 'json', method: 'taobao.item.seller.get', num_iid: '11223344', session: 'test', sign_method: 'md5', timestamp: '2016-01-01 12:00:00', v: '2.0' }
  assert.equal(topSign(params, 'helloworld'), '66987CB115214E59E6EC978214934FB8')
})

test('识别淘宝 / 天猫链接与分享文案，拒绝其他域名', async () => {
  assert.equal(extractTaobaoUrl('【淘宝】好物 https://m.tb.cn/h.abc123?tk=x CZ001 「标题」'), 'https://m.tb.cn/h.abc123?tk=x')
  assert.equal(await resolveItemId('https://item.taobao.com/item.htm?spm=a&id=6789012345'), '6789012345')
  assert.equal(await resolveItemId('https://detail.tmall.com/item.htm?id=123456789&skuId=1'), '123456789')
  assert.throws(() => extractTaobaoUrl('https://taobao.com.evil.example/item.htm?id=1'))
  assert.equal(platformForContent('https://item.taobao.com/item.htm?id=6789012345').plugin.id, 'taobao')
  assert.equal(platformForContent('https://item.jd.com/123.html').plugin.id, 'jd')
})

test('解析商品详情与万能转链结果', () => {
  const info = parseItemDetail({ results: { tbk_item_detail: [{ item_basic_info: { title: '测试商品', pict_url: '//img.alicdn.com/a.jpg' }, price_promotion_info: { zk_final_price: '99.00', final_promotion_price: '79.00', final_promotion_path_list: { final_promotion_path_map_data: [{ promotion_title: '店铺券', promotion_fee: '20' }] } }, publish_info: { income_info: { commission_amount: '3.95' } } }] } })
  assert.deepEqual(info, { title: '测试商品', image: 'https://img.alicdn.com/a.jpg', price: 9900, finalPrice: 7900, coupon: 2000, commission: 395 })
  const link = parseConvert({ data: { item_url_list: [{ link_info_dto: { coupon_short_url: 'https://s.click.taobao.com/abc', coupon_short_tpwd: '￥AbC123￥' }, coupon_info_dto: { coupon_amount: '20' }, income_info: { pure_commission_amount: '3.95' } }] } })
  assert.deepEqual(link, { error: null, url: 'https://s.click.taobao.com/abc', password: '￥AbC123￥', coupon: 2000, commission: 395 })
})

test('转链流程：详情 + 万能转链，签名参数完整', async () => {
  const original = globalThis.fetch
  const methods: string[] = []
  try {
    globalThis.fetch = async (_url, options) => {
      const p = options!.body as URLSearchParams
      const method = p.get('method')!
      methods.push(method)
      for (const k of ['app_key', 'timestamp', 'sign', 'v', 'sign_method']) assert.ok(p.get(k), k)
      if (method === 'taobao.tbk.item.info.upgrade.get') {
        assert.equal(p.get('item_id'), '6789012345')
        return new Response(JSON.stringify({ tbk_item_info_upgrade_get_response: { results: { tbk_item_detail: [{ item_basic_info: { title: '测试商品', pict_url: 'https://img.alicdn.com/a.jpg' }, price_promotion_info: { zk_final_price: '99.00' } }] } } }))
      }
      assert.equal(p.get('adzone_id'), '621564417')
      assert.deepEqual(JSON.parse(p.get('item_dto')!), [{ item_id: '6789012345' }])
      return new Response(JSON.stringify({ tbk_dg_general_link_convert_response: { data: { item_url_list: [{ link_info_dto: { cps_short_url: 'https://s.click.taobao.com/x', cps_short_tpwd: '￥Xy1￥' } }] } } }))
    }
    const r = await taobaoPlugin.convert({ appKey: 'k', appSecret: 's', pid: 'mm_1_2_621564417', adzoneId: '621564417' }, 'https://item.taobao.com/item.htm?id=6789012345')
    assert.deepEqual(methods, ['taobao.tbk.item.info.upgrade.get', 'taobao.tbk.dg.general.link.convert'])
    assert.equal(r.link, 'https://s.click.taobao.com/x')
    assert.equal(r.snapshot.password, '￥Xy1￥')
    assert.equal(r.snapshot.product, '测试商品')
    assert.equal(r.snapshot.price, 9900)
  } finally {
    globalThis.fetch = original
  }
})

test('无转链权限时给出明确原因', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (_url, options) => {
      const method = (options!.body as URLSearchParams).get('method')
      if (method === 'taobao.tbk.item.info.upgrade.get') return new Response(JSON.stringify({ tbk_item_info_upgrade_get_response: { results: { tbk_item_detail: [{ item_basic_info: { title: '测试商品' } }] } } }))
      return new Response(JSON.stringify({ error_response: { code: 11, msg: 'Insufficient isv permissions', sub_code: 'isv.permission-api-package-limit' } }))
    }
    await assert.rejects(
      taobaoPlugin.convert({ appKey: 'k', appSecret: 's', pid: 'mm_1_2_3', adzoneId: '3' }, 'https://item.taobao.com/item.htm?id=1'),
      /测试商品.*缺少该接口的权限包/,
    )
  } finally {
    globalThis.fetch = original
  }
})
