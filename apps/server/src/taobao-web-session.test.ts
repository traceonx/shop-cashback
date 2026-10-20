import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db } from './database'
import { encrypt, decrypt } from './security'
import { convertWeb, disconnectWeb, connectWebLogin, queryWebOrders, webMaintenance, webProbe, webStatus, withWebFallback } from './platforms/taobao/web'

test('网页会话完整流程：验证后替换、PID、共享节流、翻页、失效通知与恢复（全模拟）', async t => {
  const config = { pid: 'mm_123_456_7890', adzoneId: '7890', webMode: 'auto', webRpm: '20', webLookbackDays: '2' }
  let stored: any = null
  let queue = Promise.resolve()
  const tx = {
    $executeRawUnsafe: async () => 0,
    systemConfig: {
      findUnique: async () => stored,
      upsert: async (args: any) => { stored = { value: args.update.value }; return stored },
    },
  }
  const database = require('./database')
  const original = db
  database.db = {
    $transaction: (fn: any) => {
      const result = queue.then(() => fn(tx))
      queue = result.then(() => undefined, () => undefined)
      return result
    },
    affiliateConfig: { findUnique: async () => ({ encryptedConfig: encrypt(config, 'taobao-primary') }) },
  }
  t.after(() => { database.db = original })
  let response: any = { success: true, data: { result: [], hasNext: false, pageNo: 1 } }
  const requests: { url: URL; at: number; cookie: string }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push({ url: new URL(url), at: Date.now(), cookie: (init.headers as any).Cookie })
    return new Response(JSON.stringify(response), { status: 200 })
  })
  let notifications = 0
  t.mock.method(require('./wecom'), 'notifyAdmin', async () => { notifications++ })
  const unlock = () => {
    const s: any = decrypt(stored.value.encrypted, 'taobao-web-session')
    s.nextAt = 0
    stored.value.encrypted = encrypt(s, 'taobao-web-session')
  }
  const cookies = [{ name: '_tb_token_', value: 'fake-session-token', domain: '.alimama.com', path: '/' }]
  await connectWebLogin(cookies, 'test-browser-agent')
  assert.equal((await webStatus()).state, 'ACTIVE')
  assert.ok(!JSON.stringify(await webStatus()).includes('fake-session-token'))
  assert.ok(!JSON.stringify(stored).includes('fake-session-token'))
  // 新登录失败不能破坏原来可用的会话，也不能误发失效提醒。
  response = { success: false, bizErrorCode: 'NOT_LOGIN' }
  unlock()
  await assert.rejects(connectWebLogin([{ ...cookies[0], value: 'bad-new-cookie' }], 'test-browser-agent'), /失效/)
  assert.equal((await webStatus()).state, 'ACTIVE')
  assert.equal((decrypt(stored.value.encrypted, 'taobao-web-session') as any).cookie, '_tb_token_=fake-session-token')
  assert.equal((await webStatus()).notification, null)

  response = { success: true, data: { itemName: '测试', shortLinkurl: 'https://s.click.taobao.com/test', calTkRate: 270 } }
  unlock()
  const before = requests.length
  await Promise.all([
    convertWeb({ ...config, pid: 'mm_123_456_9999', adzoneId: '9999' }, '分享文案'),
    convertWeb(config, '分享文案'),
  ])
  assert.equal(requests[before].url.searchParams.get('refpid'), 'mm_123_456_9999')
  assert.equal(requests[before + 1].url.searchParams.get('refpid'), config.pid)
  assert.ok(requests[before + 1].at - requests[before].at >= 2950, '并发转链必须共享每分钟上限')
  assert.equal(requests[before].url.searchParams.get('_tb_token_'), 'fake-session-token')
  await assert.rejects(convertWeb({ ...config, adzoneId: '1111' }, '分享文案'), /不一致/)

  response = { success: true, data: { result: [], hasNext: false, pageNo: 1 } }
  unlock()
  const request = { from: new Date('2026-10-19T15:00:00Z'), until: new Date('2026-10-19T15:20:00Z'), webUntil: new Date('2026-10-19T16:10:00Z'), type: 3 as const, page: 1 }
  const first = await queryWebOrders(config, request)
  assert.equal(requests.at(-1)!.url.searchParams.get('startTime'), '2026-10-20', '跨午夜优先查询任务结束日')
  assert.equal(first.hasMore, true, '当天空订单仍继续回溯')
  unlock()
  const second = await queryWebOrders(config, { ...request, position: first.position, page: 2 })
  assert.equal(requests.at(-1)!.url.searchParams.get('startTime'), '2026-10-19')
  assert.equal(second.hasMore, false)

  response = { success: false, bizErrorCode: 'NOT_LOGIN' }
  unlock()
  await assert.rejects(webProbe(), /失效/)
  assert.equal((await webStatus()).state, 'EXPIRED')
  const count = requests.length
  await Promise.all([webMaintenance(), webMaintenance()])
  await webMaintenance()
  assert.equal(requests.length, count, '失效后维护不重复请求上游')
  assert.equal(notifications, 1)
  assert.equal((await webStatus()).notification, 'SENT')
  await assert.rejects(withWebFallback(config, async () => { throw new Error('fetch failed') }, async () => 'bad'), /fetch failed/)

  response = { success: true, data: { result: [], hasNext: false, pageNo: 1 } }
  unlock()
  await connectWebLogin(cookies, 'test-browser-agent')
  response = { success: false, bizErrorCode: 'NOT_LOGIN' }
  unlock()
  await assert.rejects(webProbe(), /失效/)
  await webMaintenance()
  assert.equal(notifications, 2, '重新登录后新的失效事件可再次通知')
  await disconnectWeb()
  await webMaintenance()
  assert.equal(notifications, 2)
  assert.equal((await webStatus()).state, 'NONE')
})
