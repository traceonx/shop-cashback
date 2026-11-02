import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearTbIdCache, freeItemInfo, tbEcapiEnabled, tbHybridConvert } from './platforms/taobao/ecapi'

test('免费返回的售价、图片、券门槛和佣金率映射为金额；未知数据不猜测', () => {
  const data = { item_id: '123', item_info: { num_iid: 123, title: '商品', zk_final_price: '12', reserve_price: '34', pict_url: '//img.alicdn.com/a.jpg' }, has_coupon: true, youhuiquan: '5', quanlimit: '12', max_commission_rate: '6.00' }
  const goods = freeItemInfo(data)
  assert.equal(goods.price, 1200)
  assert.equal(goods.coupon, 500)
  assert.equal(goods.payablePrice, 700)
  assert.equal(goods.commission, 42)
  assert.equal(goods.image, 'https://img.alicdn.com/a.jpg')
  assert.equal(freeItemInfo({ ...data, quanlimit: '20' }).payablePrice, 1200)
  assert.equal(freeItemInfo({ ...data, quanlimit: undefined }).commission, null)
  assert.equal(freeItemInfo({ ...data, coupon_end_time: '2020-01-01' }).payablePrice, null)
  assert.equal(freeItemInfo({ ...data, item_id: '456' }).price, null)
  assert.equal(freeItemInfo({ ...data, item_info: { reserve_price: '34' } }).price, null)
  assert.equal(freeItemInfo({ ...data, has_coupon: false }).commission, 72)
  assert.equal(freeItemInfo({ ...data, max_commission_rate: '101' }).commission, null)
})
import { ecapiCall } from './platforms/jd/ecapi'

test('转链缺少商品信息时用免费查询精确补价，不使用同名其他商品', async t => {
  clearTbIdCache()
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const u = new URL(String(input))
    if (u.hostname === 'c.tb.cn') return new Response('普通页面')
    if (u.pathname.endsWith('doItemHighCommissionPromotionLinkByTpwd'))
      return new Response(JSON.stringify({ code: 200, data: { item_id: '123456', short_url: 'https://s.click.taobao.com/free', tpwd: '￥FREE￥', has_coupon: false, max_commission_rate: '2' } }))
    assert.equal(u.pathname, '/taoke/getTkMaterialItem')
    assert.equal(u.searchParams.get('keyword'), 'https://s.click.taobao.com/free')
    return new Response(JSON.stringify({ code: 200, data: [
      { item_id: '999999', zk_final_price: '999', title: '同名商品' },
      { item_id: '123456', zk_final_price: '123', title: '原商品', pict_url: '//img.alicdn.com/a.jpg' },
    ] }))
  })
  const link = 'https://c.tb.cn/h.test?tk=abcdefg'
  const result = await tbHybridConvert(official, third, link, link)
  assert.equal(result.snapshot.product, '原商品')
  assert.equal(result.snapshot.price, 12300)
  assert.equal(result.snapshot.commission, 246)
})

test('付费接口在发出网络请求之前被阻止', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('不应发出付费请求'))
  for (const method of ['doTbHighCommissionPromotionUrl', 'doCommonPromotionUrlParse', 'tbkOrderDetailsGet', 'adzoneCreate', 'getTbAuthList']) {
    await assert.rejects(ecapiCall('taoke/' + method, { apkey: 'test' }), /V0.*禁止/)
  }
})

test('真实分享格式提取 tk：免费接口只返回数字 ID 时仍能转链，不调用付费解析或猜价格', async t => {
  clearTbIdCache()
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const u = new URL(String(input))
    if (u.hostname === 'c.tb.cn') return new Response('普通落地页')
    assert.equal(u.hostname, 'api.web.ecapi.cn')
    assert.equal(u.pathname, '/taoke/doItemHighCommissionPromotionLinkByTpwd')
    assert.equal(u.searchParams.get('tpwdcode'), '￥2p33TEZWrb3￥')
    assert.equal(u.searchParams.get('pid'), 'mm_1_2_621564417')
    return new Response(JSON.stringify({ code: 200, data: { item_id: '1020524973653', short_url: 'https://s.click.taobao.com/free', tpwd: '￥FREE￥', item_info: { zk_final_price: '100', pict_url: '//img.alicdn.com/test.jpg' }, has_coupon: false, max_commission_rate: '2.5' } }))
  })
  const link = 'https://c.tb.cn/h.j3vDjSTEkDzUhHP?tk=2p33TEZWrb3'
  const result = await tbHybridConvert(official, third, link, `【淘宝】${link} CZ028 「暴龙金丝钛近视眼镜框可配度数」`)
  assert.equal(result.link, 'https://s.click.taobao.com/free')
  assert.equal(result.snapshot.price, 10000)
  assert.equal(result.snapshot.payablePrice, 10000)
  assert.equal(result.snapshot.commission, 250)
  assert.equal(result.snapshot.coupon, 0)
  assert.equal(result.snapshot.password, '￥FREE￥')
})

const official = { appKey: 'k', appSecret: 's', pid: 'mm_1_2_621564417', adzoneId: '621564417' }
const third = { enabled: 'true', apiKey: 'ak', tbname: 'shop' }
const url = 'https://item.taobao.com/item.htm?id=1020524973653'
const content = `【淘宝】${url} CZ001 「暴龙金丝钛近视眼镜框可配度数」`
const row = (id: string, shop: string) => ({
  item_id: id,
  item_basic_info: { title: 'BOLON暴龙近视眼镜框商务眉架男金丝钛镜框斯文可配度数女BT6026', shop_title: shop, pict_url: '//img.alicdn.com/a.jpg' },
  price_promotion_info: { zk_final_price: '1138', final_promotion_price: '873', final_promotion_path_list: { final_promotion_path_map_data: [{ promotion_title: '店铺券', promotion_fee: '95' }] } },
  publish_info: { coupon_share_url: '//s.click.taobao.com/t?e=m%3D2%26s%3DLONGOFFICIAL', income_info: { commission_amount: '13.36' } },
})

function mock(officialRows: unknown[], spreadOk = true) {
  const calls: string[] = []
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input))
    if (u.hostname === 'api.web.ecapi.cn') {
      calls.push(u.pathname)
      assert.equal(u.searchParams.get('tbname'), 'shop')
      assert.equal(u.searchParams.get('pid'), 'mm_1_2_621564417')
      assert.equal(u.pathname, '/taoke/doItemHighCommissionPromotionLink')
      assert.equal(u.searchParams.get('itemid'), '1020524973653')
      return new Response(JSON.stringify({ code: 200, data: { item_info: { zk_final_price: '1138' }, item_id: 'oQa8pyahrt-NEWID', short_url: 'https://s.click.taobao.com/ecapi', tpwd: '￥ECAPI￥' } }))
    }
    const p = init!.body as URLSearchParams
    calls.push(p.get('method')!)
    if (p.get('method') === 'taobao.tbk.spread.get') {
      assert.equal(JSON.parse(p.get('requests')!)[0].url, 'https://s.click.taobao.com/t?e=m%3D2%26s%3DLONGOFFICIAL')
      return new Response(JSON.stringify(spreadOk ? { tbk_spread_get_response: { results: { tbk_spread: [{ content: 'https://s.click.taobao.com/short1', err_msg: 'OK' }] } } } : { error_response: { code: 11, msg: 'Insufficient isv permissions' } }))
    }
    if (p.get('method') === 'taobao.tbk.tpwd.create') return new Response(JSON.stringify({ tbk_tpwd_create_response: { data: { password_simple: '￥OFFICIAL￥' } } }))
    assert.equal(p.get('q'), 'https://uland.taobao.com/item/edetail?id=oQa8pyahrt-NEWID')
    return new Response(JSON.stringify({ tbk_dg_material_optional_upgrade_response: { result_list: { map_data: officialRows } } }))
  }
  return calls
}

test('开关与凭证同时满足才启用淘宝混合转链', () => {
  assert.equal(tbEcapiEnabled(third), true)
  assert.equal(tbEcapiEnabled({ ...third, enabled: 'false' }), false)
  assert.equal(tbEcapiEnabled({ enabled: 'true', apiKey: 'ak' }), false)
})

test('喵有券解析新版 ID 后按 ID 命中官方物料，同款他店不会被选中；重复商品走缓存', async () => {
  const original = globalThis.fetch
  clearTbIdCache()
  try {
    const calls = mock([row('8B5mjq-OTHER', '博士眼镜官方旗舰店'), row('oQa8pyahrt-NEWID', '暴龙品尊专卖店')])
    const r = await tbHybridConvert(official, third, url, content)
    assert.equal(r.link, 'https://s.click.taobao.com/short1')
    assert.equal(r.snapshot.shop, '暴龙品尊专卖店')
    assert.equal(r.snapshot.price, 113800)
    assert.equal(r.snapshot.payablePrice, 87300)
    assert.equal(r.snapshot.coupon, 9500)
    assert.equal(r.snapshot.commission, 1336)
    assert.equal(r.snapshot.password, '￥OFFICIAL￥')
    assert.equal(calls.filter((c) => c.startsWith('/taoke/')).length, 1)
    await tbHybridConvert(official, third, url, content)
    assert.equal(calls.filter((c) => c.startsWith('/taoke/')).length, 1)
  } finally {
    globalThis.fetch = original
  }
})

test('按新版ID链接精确查询的单条结果允许官方重新生成动态ID', async () => {
  const original = globalThis.fetch
  clearTbIdCache()
  try {
    mock([row('differentDynamicPrefix-NEWID', '暴龙品尊专卖店')])
    const r = await tbHybridConvert(official, third, url, content)
    assert.equal(r.link, 'https://s.click.taobao.com/short1')
    assert.equal(r.snapshot.price, 113800)
    assert.equal(r.snapshot.payablePrice, 87300)
    assert.equal(r.snapshot.commission, 1336)
    assert.equal(r.snapshot.imageUrl, 'https://img.alicdn.com/a.jpg')
  } finally {
    globalThis.fetch = original
  }
})

test('官方精确查询返回多个未匹配商品时用喵有券推广链接兜底，不展示佣金', async () => {
  const original = globalThis.fetch
  clearTbIdCache()
  try {
    mock([row('8B5mjq-OTHER', '博士眼镜官方旗舰店'), row('9C6njr-ANOTHER', '另一家店')])
    const r = await tbHybridConvert(official, third, url, content)
    assert.equal(r.link, 'https://s.click.taobao.com/ecapi')
    assert.equal(r.snapshot.password, '￥ECAPI￥')
    assert.equal(r.snapshot.commission, null)
    assert.match(r.snapshot.infoMessage!, /喵有券推广链接/)
  } finally {
    globalThis.fetch = original
  }
})

test('官方长链转短链未开通时，用喵有券推广短链（含缓存）替代长链', async () => {
  const original = globalThis.fetch
  clearTbIdCache()
  try {
    mock([row('oQa8pyahrt-NEWID', '暴龙品尊专卖店')], false)
    const r = await tbHybridConvert(official, third, url, content)
    assert.equal(r.link, 'https://s.click.taobao.com/ecapi')
    assert.equal(r.snapshot.commission, 1336)
    const again = await tbHybridConvert(official, third, url, content)
    assert.equal(again.link, 'https://s.click.taobao.com/ecapi')
  } finally {
    globalThis.fetch = original
  }
})

test('不同分享短链即使落地页里搜到同一个数字 ID，也不会命中彼此的缓存', async () => {
  const original = globalThis.fetch
  clearTbIdCache()
  const ecapiMaterials: string[] = []
  try {
    globalThis.fetch = async (input, init) => {
      const u = new URL(String(input))
      // 两个短链都返回包含同一个无关 ID 的落地页
      if (u.hostname === 'c.tb.cn') return new Response('<script src="//g.alicdn.com/x.js?id=99999999"></script>', { status: 200 })
      if (u.hostname === 'api.web.ecapi.cn') {
        assert.equal(u.pathname, '/taoke/doItemHighCommissionPromotionLinkByTpwd')
        const m = u.searchParams.get('tpwdcode')!
        ecapiMaterials.push(m)
        const id = m.includes('AAAAAA') ? 'aaaaaaaa-NEWA' : 'bbbbbbbb-NEWB'
        return new Response(JSON.stringify({ code: 200, data: { item_id: id, short_url: 'https://s.click.taobao.com/' + id.slice(0, 4) } }))
      }
      const p = init!.body as URLSearchParams
      if (p.get('method') === 'taobao.tbk.tpwd.create') return new Response(JSON.stringify({ tbk_tpwd_create_response: { data: { password_simple: '￥T￥' } } }))
      const id = p.get('q')!.split('id=')[1]
      return new Response(JSON.stringify({ tbk_dg_material_optional_upgrade_response: { result_list: { map_data: [{ ...row(id, id.endsWith('NEWA') ? 'A店' : 'B店'), publish_info: { click_url: `//s.click.taobao.com/${id.slice(0, 4)}`, income_info: { commission_amount: '1' } } }] } } }))
    }
    const a = await tbHybridConvert(official, third, 'https://c.tb.cn/h.AAA?tk=AAAAAA', '【淘宝】https://c.tb.cn/h.AAA?tk=AAAAAA 「A商品」')
    const b = await tbHybridConvert(official, third, 'https://c.tb.cn/h.BBB?tk=BBBBBB', '【淘宝】https://c.tb.cn/h.BBB?tk=BBBBBB 「B商品」')
    assert.equal(a.snapshot.shop, 'A店')
    assert.equal(b.snapshot.shop, 'B店')
    assert.equal(ecapiMaterials.length, 2)
  } finally {
    globalThis.fetch = original
  }
})
