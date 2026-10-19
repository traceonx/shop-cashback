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
  assert.deepEqual(info, { itemId: null, title: '测试商品', image: 'https://img.alicdn.com/a.jpg', price: 9900, finalPrice: 7900, coupon: 2000, commission: 395 })
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

test('无万能转链权限时改用物料搜索转链，并生成淘口令', async () => {
  const original = globalThis.fetch
  const methods: string[] = []
  try {
    globalThis.fetch = async (_url, options) => {
      const p = options!.body as URLSearchParams
      const method = p.get('method')!
      methods.push(method)
      const ok = (key: string, body: unknown) => new Response(JSON.stringify({ [key]: body }))
      if (method === 'taobao.tbk.item.info.upgrade.get')
        return ok('tbk_item_info_upgrade_get_response', { results: { tbk_item_detail: [{ item_id: 'AbC-123', item_basic_info: { title: '测试 商品', pict_url: 'https://img.alicdn.com/a.jpg' }, price_promotion_info: { zk_final_price: '99.00' } }] } })
      if (method === 'taobao.tbk.dg.general.link.convert')
        return new Response(JSON.stringify({ error_response: { code: 11, msg: 'Insufficient isv permissions', sub_code: 'isv.permission-api-package-limit' } }))
      if (method === 'taobao.tbk.dg.material.optional.upgrade') {
        assert.equal(p.get('adzone_id'), '3')
        assert.equal(p.get('q'), '测试 商品')
        return ok('tbk_dg_material_optional_upgrade_response', { result_list: { map_data: [
          { item_id: 'Other-1', item_basic_info: { title: '别的商品' }, publish_info: { click_url: '//s.click.taobao.com/wrong' } },
          { item_id: 'AbC-123', item_basic_info: { title: '测试 商品' }, price_promotion_info: { final_promotion_price: '79.00' }, publish_info: { coupon_share_url: '//uland.taobao.com/coupon/edetail?e=x', income_info: { commission_amount: '3.95' } } },
        ] } })
      }
      if (method === 'taobao.tbk.spread.get') {
        assert.equal(JSON.parse(p.get('requests')!)[0].url, 'https://uland.taobao.com/coupon/edetail?e=x')
        return ok('tbk_spread_get_response', { results: { tbk_spread: [{ content: 'https://s.click.taobao.com/Tb88s', err_msg: 'OK' }] } })
      }
      assert.equal(method, 'taobao.tbk.tpwd.create')
      assert.equal(p.get('url'), 'https://s.click.taobao.com/Tb88s')
      return ok('tbk_tpwd_create_response', { data: { password_simple: '￥Tb88￥' } })
    }
    const r = await taobaoPlugin.convert({ appKey: 'k', appSecret: 's', pid: 'mm_1_2_3', adzoneId: '3' }, 'https://item.taobao.com/item.htm?id=1')
    assert.deepEqual(methods, ['taobao.tbk.item.info.upgrade.get', 'taobao.tbk.dg.general.link.convert', 'taobao.tbk.dg.material.optional.upgrade', 'taobao.tbk.spread.get', 'taobao.tbk.tpwd.create'])
    assert.equal(r.link, 'https://s.click.taobao.com/Tb88s')
    assert.equal(r.snapshot.password, '￥Tb88￥')
    assert.equal(r.snapshot.commission, 395)
    assert.equal(r.snapshot.payablePrice, 7900)
  } finally {
    globalThis.fetch = original
  }
})

test('物料搜索找不到商品时给出明确原因', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (_url, options) => {
      const method = (options!.body as URLSearchParams).get('method')
      if (method === 'taobao.tbk.item.info.upgrade.get') return new Response(JSON.stringify({ tbk_item_info_upgrade_get_response: { results: { tbk_item_detail: [{ item_id: 'X', item_basic_info: { title: '测试商品' } }] } } }))
      if (method === 'taobao.tbk.dg.general.link.convert') return new Response(JSON.stringify({ error_response: { code: 11, sub_code: 'isv.permission-api-package-limit' } }))
      return new Response(JSON.stringify({ tbk_dg_material_optional_upgrade_response: { result_list: { map_data: [] } } }))
    }
    await assert.rejects(
      taobaoPlugin.convert({ appKey: 'k', appSecret: 's', pid: 'mm_1_2_3', adzoneId: '3' }, 'https://item.taobao.com/item.htm?id=1'),
      /测试商品.*物料搜索未找到该商品/,
    )
  } finally {
    globalThis.fetch = original
  }
})

test('短链跳转参数与分享文案：多层编码中找商品 ID、提取「」标题', async () => {
  const { idFromText, shareTitle } = await import('./platforms/taobao')
  assert.equal(idFromText('https://login.taobao.com/login.htm?redirectURL=https%3A%2F%2Fitem.taobao.com%2Fitem.htm%3Fspm%3Da%26id%3D778899001122'), '778899001122')
  assert.equal(idFromText("var url = 'https://a.m.taobao.com/i665544332211.htm?price=1'"), '665544332211')
  assert.equal(idFromText('https://login.taobao.com/x?redirectURL=https%3a%2f%2fitem.taobao.com%2fwow%2fz%2fhome%3Frand%3Dabc'), null)
  assert.equal(shareTitle('【淘宝】https://e.tb.cn/h.abc?tk=x CZ321 「Mistine蜜丝婷小果泥唇霜」\n点击链接直接打开'), 'Mistine蜜丝婷小果泥唇霜')
  assert.equal(shareTitle('https://item.taobao.com/item.htm?id=1'), null)
  assert.equal(shareTitle('【淘宝】https://m.tb.cn/h.j1E2Yyg?tk=SHiTTuBbca7 MF278 【李佳琦双11超级母婴节付定金】嫚熙秋冬月子服女士睡衣家居服 '), '嫚熙秋冬月子服女士睡衣家居服')
  assert.equal(shareTitle('【淘宝】https://m.tb.cn/h.j2fsdxI?tk=Zls2TuB2N0o HU071 【李佳琦双11超级母婴节付定金】嫚熙含桑蚕丝莫代尔孕妇内裤高弹'), '嫚熙含桑蚕丝莫代尔孕妇内裤高弹')
})

test('详情接口失败时用分享文案标题走物料搜索', async () => {
  const original = globalThis.fetch
  const methods: string[] = []
  try {
    globalThis.fetch = async (_url, options) => {
      const p = options!.body as URLSearchParams
      const method = p.get('method')!
      methods.push(method)
      if (method === 'taobao.tbk.item.info.upgrade.get') return new Response(JSON.stringify({ error_response: { code: 15, msg: 'Remote service error', sub_msg: '商品不存在' } }))
      if (method === 'taobao.tbk.dg.general.link.convert') return new Response(JSON.stringify({ error_response: { code: 11, sub_code: 'isv.permission-api-package-limit' } }))
      if (method === 'taobao.tbk.dg.material.optional.upgrade') {
        assert.equal(p.get('q'), 'Mistine蜜丝婷小果泥唇霜果汁唇釉')
        return new Response(JSON.stringify({ tbk_dg_material_optional_upgrade_response: { result_list: { map_data: [
          { item_id: 'Zz-9', item_basic_info: { title: 'Mistine蜜丝婷小果泥唇霜果汁唇釉唇泥雾面口红学生' }, publish_info: { click_url: '//s.click.taobao.com/ok' } },
        ] } } }))
      }
      return new Response(JSON.stringify({ tbk_tpwd_create_response: { data: { password_simple: '￥X￥' } } }))
    }
    const r = await taobaoPlugin.convert({ appKey: 'k', appSecret: 's', pid: 'mm_1_2_3', adzoneId: '3' }, 'https://item.taobao.com/item.htm?id=778899', undefined, '【淘宝】https://e.tb.cn/h.x CZ321 「Mistine蜜丝婷小果泥唇霜果汁唇釉」')
    assert.equal(r.link, 'https://s.click.taobao.com/ok')
    assert.equal(r.snapshot.product, 'Mistine蜜丝婷小果泥唇霜果汁唇釉')
  } finally {
    globalThis.fetch = original
  }
})

test('短链落地页标题提取，过滤登录 / 通用标题', async () => {
  const { titleFromHtml } = await import('./platforms/taobao')
  assert.equal(titleFromHtml('<html><head><title>Mistine蜜丝婷小果泥唇霜-淘宝网</title></head></html>'), 'Mistine蜜丝婷小果泥唇霜')
  assert.equal(titleFromHtml('<meta property="og:title" content="夏季纯棉短袖T恤男">'), '夏季纯棉短袖T恤男')
  assert.equal(titleFromHtml('<title>淘宝网 - 淘！我喜欢</title>'), null)
  assert.equal(titleFromHtml('<title>登录</title>'), null)
})

test('数字商品 ID 被拒（-4003）且无标题时，提示发送完整分享文案', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (_url, options) => {
      const method = (options!.body as URLSearchParams).get('method')
      if (method === 'taobao.tbk.item.info.upgrade.get') return new Response(JSON.stringify({ error_response: { code: 15, msg: 'Remote service error', sub_code: '-4003', sub_msg: '您输入的商品ID不合法，请使用升级后的新商品ID' } }))
      return new Response(JSON.stringify({ error_response: { code: 11, sub_code: 'isv.permission-api-package-limit' } }))
    }
    await assert.rejects(
      taobaoPlugin.convert({ appKey: 'k', appSecret: 's', pid: 'mm_1_2_3', adzoneId: '3' }, 'https://item.taobao.com/item.htm?id=1'),
      /不支持用链接中的数字商品 ID.*完整分享文案/,
    )
  } finally {
    globalThis.fetch = original
  }
})

test('同名商品多家店铺在卖时不转链，避免换成别家店铺', async () => {
  const { parseMaterialSearch } = await import('./platforms/taobao')
  const row = (id: string, title: string, seller: string, shop: string) => ({ item_id: id, item_basic_info: { title, seller_id: seller, shop_title: shop }, publish_info: { click_url: '//s.click.taobao.com/' + id } })
  // 商品 ID 命中：即使有同名商品也直接采用
  const byId = parseMaterialSearch([row('A-1', '同款', '1', 'A店'), row('B-1', '同款', '2', 'B店')], 'B-1', '同款')
  assert.equal(byId.status, 'ok')
  assert.equal(byId.status === 'ok' && byId.shop, 'B店')
  // 标题完全一致但属于两家店：无法确定
  const amb = parseMaterialSearch([row('A-1', '小果泥唇霜 果汁唇釉', '1', 'A店'), row('B-1', '小果泥唇霜果汁唇釉', '2', 'B店')], '778899', '小果泥唇霜果汁唇釉')
  assert.deepEqual(amb, { status: 'ambiguous', shops: ['A店', 'B店'] })
  // 同一家店的多个同名链接：采用，并返回店铺名
  const one = parseMaterialSearch([row('A-1', '小果泥唇霜果汁唇釉', '1', 'A店'), row('A-2', '小果泥唇霜果汁唇釉', '1', 'A店'), row('C-1', '别的东西', '3', 'C店')], null, '小果泥唇霜果汁唇釉')
  assert.equal(one.status === 'ok' && one.shop, 'A店')
  // 模糊匹配有多个候选：不采用
  const fuzzy = parseMaterialSearch([row('A-1', '小果泥唇霜果汁唇釉礼盒装', '1', 'A店'), row('B-1', '小果泥唇霜果汁唇釉旗舰款', '2', 'B店')], null, '小果泥唇霜果汁唇釉')
  assert.equal(fuzzy.status, 'ambiguous')
  assert.deepEqual(parseMaterialSearch([], null, '小果泥唇霜果汁唇釉'), { status: 'none' })
})
