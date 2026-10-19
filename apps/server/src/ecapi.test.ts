import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ecapiConvert, ecapiEnabled, ecapiGoods, ecapiRequest } from './platforms/jd/ecapi'
import { activeProxy } from './proxy'

const config = { enabled: 'true', apiKey: 'ak', keyId: 'kid' }
const now = Date.now()
const item = (couponList: unknown[]) => ({
  skuId: 100012345678,
  skuName: '南孚7号碱性电池 6粒',
  priceInfo: { price: '18.60', lowestCouponPrice: '18.60' },
  commissionInfo: { commission: '0.19', commissionShare: 1 },
  couponInfo: { couponList },
  imageInfo: { imageList: [{ url: 'https://img14.360buyimg.com/a.jpg' }] },
})

test('开关与凭证同时满足才启用第三方转链', () => {
  assert.equal(ecapiEnabled(config), true)
  assert.equal(ecapiEnabled({ ...config, enabled: 'false' }), false)
  assert.equal(ecapiEnabled({ enabled: 'true', apiKey: 'ak' }), false)
})

test('券门槛高于单件售价时按无券计算佣金与到手价', () => {
  const g = ecapiGoods(item([{ quota: '200', discount: '25', isBest: 1 }, { quota: '1500', discount: '150' }]))
  assert.equal(g.price, 1860)
  assert.equal(g.coupon, 0)
  assert.equal(g.payablePrice, 1860)
  assert.equal(g.commission, 19)
  assert.equal(g.couponUrl, undefined)
})

test('查券后生成含券推广链接，并带上用户标识与推广位', async () => {
  const original = globalThis.fetch
  const calls: URL[] = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    calls.push(url)
    assert.equal(url.origin, 'https://api.web.ecapi.cn')
    assert.equal(url.searchParams.get('apkey'), 'ak')
    assert.equal(url.searchParams.get('key_id'), 'kid')
    if (url.pathname.endsWith('getJdUnionItems')) {
      const coupon = { quota: '10', discount: '2', isBest: 1, link: 'https://coupon.m.jd.com/coupons/show.action?key=x', getStartTime: now - 1, getEndTime: now + 1e6, useStartTime: now - 1, useEndTime: now + 1e6 }
      const goods = { ...item([coupon]), priceInfo: { price: '18.60', lowestCouponPrice: '16.60' }, commissionInfo: { commission: '0.19', couponCommission: '0.17' } }
      return new Response(JSON.stringify({ code: 200, data: { list: [goods], totalCount: 1 }, msg: 'suc' }))
    }
    return new Response(JSON.stringify({ code: 200, data: { shortURL: 'https://u.jd.com/abc', clickURL: 'https://union-click.jd.com/jdc?e=1' }, msg: 'suc' }))
  }
  try {
    const r = await ecapiConvert({ ...config, positionId: '88' }, 'https://3.cn/test', 'a'.repeat(32))
    assert.equal(r.link, 'https://u.jd.com/abc')
    assert.equal(r.snapshot.coupon, 200)
    assert.equal(r.snapshot.payablePrice, 1660)
    assert.equal(r.snapshot.commission, 17)
    assert.equal(r.snapshot.sku, '100012345678')
    const cps = calls[1].searchParams
    assert.equal(cps.get('materialId'), 'https://item.jd.com/100012345678.html')
    assert.equal(cps.get('couponUrl'), 'https://coupon.m.jd.com/coupons/show.action?key=x')
    assert.equal(cps.get('positionId'), '88')
    assert.equal(cps.get('subUnionId'), 'a'.repeat(32))
    assert.equal(cps.get('sceneId'), '2')
  } finally {
    globalThis.fetch = original
  }
})

test('白名单错误给出处理提示，非京东推广链接被拒绝', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 401, msg: 'IP非法' }))
    await assert.rejects(ecapiRequest(config, 'getJdUnionItems', {}), /白名单/)
    globalThis.fetch = async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes('getJdUnionItems')
            ? { code: 200, data: { list: [] } }
            : { code: 200, data: { shortURL: 'https://evil.example/x' } },
        ),
      )
    await assert.rejects(ecapiConvert(config, 'https://item.jd.com/1.html'), /有效的京东推广链接/)
  } finally {
    globalThis.fetch = original
  }
})

test('设置 PROXY_HOST 时喵有券走代理，401 提示当前代理', async () => {
  const original = globalThis.fetch
  const env = process.env.PROXY_HOST
  try {
    process.env.PROXY_HOST = 'http://192.168.5.199:7890'
    assert.equal(activeProxy('ecapi')?.host, '192.168.5.199')
    delete process.env.PROXY_HOST
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 401, msg: 'IP非法' }))
    await assert.rejects(ecapiRequest(config, 'getJdUnionItems', {}), /当前直连/)
  } finally {
    globalThis.fetch = original
    if (env === undefined) delete process.env.PROXY_HOST
    else process.env.PROXY_HOST = env
  }
})
