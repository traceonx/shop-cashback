import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { browserLoginStatus, cancelBrowserLogin, startBrowserLogin, browserLoginScreenshot, verifyBrowserLogin, browserLoginDrag } from './platforms/taobao/web-browser'
import { WebError } from './platforms/taobao/web-core'

test('匿名 token 不查订单；人工验证失败后暂停，冷却期内不再次请求', async t => {
  t.mock.method(require('./integrations'), 'readConfig', async () => ({ pid: 'mm_123_456_7890' }))
  let attempts = 0
  const moves: string[] = []
  const page = { goto: async () => undefined, url: () => 'https://pub.alimama.com/', evaluate: async () => 'UA',
    mouse: { move: async (x: number, y: number) => { moves.push(x + ',' + y) }, down: async () => { moves.push('down') }, up: async () => { moves.push('up') } } }

  const context = { pages: () => [page], route: async () => undefined, on: () => undefined,
    cookies: async () => [{ name: '_tb_token_', value: 'anonymous' }], close: async () => undefined }
  t.mock.method(chromium, 'launchPersistentContext', async () => context as any)
  t.mock.method(require('./platforms/taobao/web'), 'connectWebLogin', async () => {
    attempts++; throw new WebError('VERIFY', '需要人工验证')
  })
  t.after(cancelBrowserLogin)
  await startBrowserLogin()
  for (let i = 0; i < 50 && browserLoginStatus().state === 'OPENING'; i++) await new Promise(r => setTimeout(r, 5))
  assert.equal(attempts, 0)
  await browserLoginDrag([{ x: 10, y: 20 }, { x: 30, y: 20 }])
  assert.deepEqual(moves, ['10,20', 'down', '30,20', 'up'])
  assert.equal(browserLoginStatus().state, 'WAITING')
  await verifyBrowserLogin()
  assert.equal(attempts, 1)
  assert.equal((browserLoginStatus() as any).paused, true)
  assert.match(browserLoginStatus().message, /已暂停自动请求/)
  await assert.rejects(verifyBrowserLogin(), /一分钟/)
  assert.equal(attempts, 1)
  await assert.rejects(browserLoginDrag([{ x: 0, y: 0 }, { x: Infinity, y: 1 }]), /拖动位置无效/)
})

test('点击登录启动独立浏览器，登录成功自动验证保存并关闭；无需配对码', async t => {
  t.mock.method(require('./integrations'), 'readConfig', async () => ({ pid: 'mm_123_456_7890' }))
  let closed = 0, connects = 0
  const page = {
    goto: async () => undefined, url: () => 'https://pub.alimama.com/portal/v2/effect/order/overviewOrder/page/index.htm',
    evaluate: async () => 'BrowserFromTest', screenshot: async () => Buffer.from('test-image'),
  }
  const context = {
    pages: () => [page], route: async () => undefined, on: () => undefined,
    cookies: async () => [{ name: '_tb_token_', value: 'test-cookie', domain: '.alimama.com', path: '/' }, { name: 'login', value: 'true', domain: '.alimama.com', path: '/' }],
    close: async () => { closed++ },
  }
  t.mock.method(chromium, 'launchPersistentContext', async (profile: string, options: any) => {
    assert.match(profile, /taobao-web-browser$/)
    assert.deepEqual(options.viewport, { width: 1280, height: 800 })
    return context as any
  })
  t.mock.method(require('./platforms/taobao/web'), 'connectWebLogin', async (cookies: any[], userAgent: string, active: () => boolean) => {
    assert.equal(cookies[0].value, 'test-cookie')
    assert.equal(userAgent, 'BrowserFromTest')
    assert.equal(active(), true)
    connects++
  })
  t.after(cancelBrowserLogin)
  const first = await startBrowserLogin()
  assert.equal(first.state, 'OPENING')
  assert.equal('token' in first, false)
  for (let i = 0; i < 50 && browserLoginStatus().state !== 'CONNECTED'; i++) await new Promise(r => setTimeout(r, 10))
  assert.equal(browserLoginStatus().state, 'CONNECTED')
  assert.equal(connects, 1)
  assert.equal(closed, 1)
  assert.equal(await browserLoginScreenshot(), null)
})

test('浏览器无法启动时返回可操作的错误，允许重新登录', async t => {
  t.mock.method(require('./integrations'), 'readConfig', async () => ({ pid: 'mm_123_456_7890' }))
  t.mock.method(chromium, 'launchPersistentContext', async () => { throw new Error('browser unavailable') })
  t.after(cancelBrowserLogin)
  await startBrowserLogin()
  for (let i = 0; i < 50 && browserLoginStatus().state !== 'ERROR'; i++) await new Promise(r => setTimeout(r, 10))
  assert.equal(browserLoginStatus().state, 'ERROR')
  assert.match(browserLoginStatus().message, /Chrome 或 Edge/)
  assert.equal((await startBrowserLogin()).state, 'OPENING')
})
