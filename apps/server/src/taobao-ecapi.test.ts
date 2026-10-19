import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearTbIdCache, tbEcapiEnabled, tbHybridConvert } from './platforms/taobao/ecapi'

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
      if (u.pathname.endsWith('doTbHighCommissionPromotionUrl')) {
        assert.equal(u.searchParams.get('material_list'), content)
        return new Response(JSON.stringify({ code: 200, data: { material_url_list: [{ link_info_dto: { material_type: 1, material_id: '1020524973653', cps_short_url: 'https://s.click.taobao.com/ecapi', cps_short_tpwd: '￥ECAPI￥' } }] } }))
      }
      assert.equal(u.searchParams.get('material_url'), '￥ECAPI￥')
      return new Response(JSON.stringify({ code: 200, data: [{ link_info_dto: { material_id: 'oQa8pyahrt-NEWID' } }] }))
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
    assert.equal(calls.filter((c) => c.startsWith('/taoke/')).length, 2)
    await tbHybridConvert(official, third, url, content)
    assert.equal(calls.filter((c) => c.startsWith('/taoke/')).length, 2)
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
        if (u.pathname.endsWith('doTbHighCommissionPromotionUrl')) {
          const m = u.searchParams.get('material_list')!
          ecapiMaterials.push(m)
          const id = m.includes('AAA') ? 'aaaaaaaa-NEWA' : 'bbbbbbbb-NEWB'
          return new Response(JSON.stringify({ code: 200, data: { material_url_list: [{ link_info_dto: { material_type: 1, material_id: id, cps_short_url: `https://s.click.taobao.com/${id.slice(0, 4)}` } }] } }))
        }
      }
      const p = init!.body as URLSearchParams
      if (p.get('method') === 'taobao.tbk.tpwd.create') return new Response(JSON.stringify({ tbk_tpwd_create_response: { data: { password_simple: '￥T￥' } } }))
      const id = p.get('q')!.split('id=')[1]
      return new Response(JSON.stringify({ tbk_dg_material_optional_upgrade_response: { result_list: { map_data: [{ ...row(id, id.endsWith('NEWA') ? 'A店' : 'B店'), publish_info: { click_url: `//s.click.taobao.com/${id.slice(0, 4)}`, income_info: { commission_amount: '1' } } }] } } }))
    }
    const a = await tbHybridConvert(official, third, 'https://c.tb.cn/h.AAA?tk=1', '【淘宝】https://c.tb.cn/h.AAA?tk=1 「A商品」')
    const b = await tbHybridConvert(official, third, 'https://c.tb.cn/h.BBB?tk=2', '【淘宝】https://c.tb.cn/h.BBB?tk=2 「B商品」')
    assert.equal(a.snapshot.shop, 'A店')
    assert.equal(b.snapshot.shop, 'B店')
    assert.equal(ecapiMaterials.length, 2)
  } finally {
    globalThis.fetch = original
  }
})
