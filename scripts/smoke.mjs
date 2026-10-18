import 'dotenv/config'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'
const schema = 'test_' + randomBytes(8).toString('hex'),
  url = new URL(process.env.DATABASE_URL)
url.searchParams.set('schema', schema)
const db = new PrismaClient({ datasourceUrl: url.toString() }),
  root = new PrismaClient()
const testEnv = { ...process.env, DATABASE_URL: url.toString(), PORT: '3107', HOST: '127.0.0.1' }
let child
async function start() {
  child = spawn(process.execPath, ['apps/server/dist/main.js'], { env: testEnv, stdio: 'pipe' })
  let output = ''
  child.stderr.on('data', (b) => (output += b))
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:3107/api/v1/health')).ok) return
    } catch {}
    await delay(100)
  }
  throw new Error('Test server not ready: ' + output)
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill()
    await once(child, 'exit')
    child = undefined
  }
}
async function request(path, method = 'GET', body, token) {
  return fetch('http://127.0.0.1:3107/api/v1' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
const password = 'a'
try {
  const migration = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: testEnv,
    stdio: 'pipe',
  })
  let migrationOutput = ''
  migration.stderr.on('data', (b) => (migrationOutput += b))
  const [code] = await once(migration, 'exit')
  assert.equal(code, 0, migrationOutput)
  const salt = randomBytes(16).toString('hex'),
    passwordHash = salt + ':' + scryptSync(password, salt, 64).toString('hex')
  await start()
  assert.equal((await (await request('/auth/setup-status')).json()).data.initialized, false)
  assert.equal((await request('/auth/setup', 'POST', { username: 'admin', password: '' })).status, 400)
  const attempts = await Promise.all(
    [1, 2].map(() => request('/auth/setup', 'POST', { username: 'super_admin@test.invalid', password })),
  )
  assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 403])
  assert.equal(await db.adminUser.count(), 1)
  assert.equal((await (await request('/auth/setup-status')).json()).data.initialized, true)
  const financeRole = await db.role.create({ data: { name: 'FINANCE' } })
  await db.adminUser.create({ data: { username: 'finance@test.invalid', passwordHash, roleId: financeRole.id } })
  assert.equal((await request('/users')).status, 401)
  assert.equal((await request('/auth/login', 'POST', { role: 'SUPER_ADMIN' })).status, 400)
  const login = async (role) =>
    (await (await request('/auth/login', 'POST', { username: role.toLowerCase() + '@test.invalid', password })).json())
      .data.token
  let token = await login('SUPER_ADMIN')
  assert.equal((await request('/auth/login', 'POST', { username: 'finance@test.invalid', password })).status, 401)
  const oldToken = token
  assert.equal(
    (
      await request(
        '/auth/change-password',
        'POST',
        { currentPassword: 'wrong', newPassword: password + 'new' },
        token,
      )
    ).status,
    400,
  )
  assert.equal(
    (
      await request(
        '/auth/change-password',
        'POST',
        { currentPassword: password, newPassword: password + 'new' },
        token,
      )
    ).status,
    201,
  )
  assert.equal((await request('/auth/profile', 'GET', undefined, oldToken)).status, 401)
  assert.equal((await request('/auth/login', 'POST', { username: 'finance@test.invalid', password })).status, 401)
  const newLogin = await request('/auth/login', 'POST', {
    username: 'super_admin@test.invalid',
    password: password + 'new',
  })
  assert.equal(newLogin.status, 201)
  token = (await newLogin.json()).data.token
  for (const route of ['/orders', '/users', '/promotions', '/withdrawals'])
    assert.deepEqual((await (await request(route, 'GET', undefined, token)).json()).data, [])
  const overview = (await (await request('/dashboard/overview', 'GET', undefined, token)).json()).data
  assert.equal(overview.newOrders, 0)
  assert.equal(overview.commission, 0)
  const missing = await request('/promotions/convert', 'POST', { content: 'https://item.jd.com/123.html' }, token)
  assert.equal(missing.status, 400)
  const testSecret = 'test-only-secret-' + randomBytes(12).toString('hex')
  let r = await request(
    '/integrations/jd',
    'PUT',
    { appKey: 'test-key', appSecret: testSecret, siteId: '100', positionId: '200' },
    token,
  )
  assert.equal(r.status, 200)
  let result = await r.json()
  assert.ok(!JSON.stringify(result).includes(testSecret))
  assert.equal(result.data.fields.find((f) => f.key === 'appSecret').configured, true)
  const details = await request('/integrations/jd/details', 'POST', {}, token)
  assert.equal(details.status, 201)
  assert.equal(details.headers.get('cache-control'), 'no-store')
  assert.equal((await details.json()).data.fields.find((f) => f.key === 'appSecret').value, testSecret)
  assert.equal((await request('/wecom/menu')).status, 401)
  const menu = (await (await request('/wecom/menu', 'GET', undefined, token)).json()).data
  assert.equal(menu.draft.length, 3)
  menu.draft[0].name = '购物优惠'
  assert.equal((await request('/wecom/menu', 'PUT', { draft: menu.draft }, token)).status, 200)
  assert.equal((await request('/wecom/menu', 'PUT', { draft: [] }, token)).status, 400)
  assert.equal((await (await request('/wecom/menu', 'GET', undefined, token)).json()).data.draft[0].name, '购物优惠')
  assert.equal((await request('/wecom/menu/publish', 'POST', { draft: menu.draft }, token)).status, 400)
  assert.equal((await request('/integrations/taobao', 'PUT', { pid: 'bad-pid' }, token)).status, 400)
  const tb = await request('/integrations/taobao', 'PUT', { appKey: 'tb-test', appSecret: testSecret, pid: 'mm_1_2_345' }, token)
  assert.equal(tb.status, 200)
  const tbStatus = (await tb.json()).data
  assert.equal(tbStatus.configured, true)
  assert.equal(tbStatus.fields.find((f) => f.key === 'adzoneId').value, '345')
  assert.ok(!JSON.stringify(tbStatus).includes(testSecret))
  await request('/integrations/taobao', 'PUT', { appSecret: '', pid: 'mm_1_2_678' }, token)
  const tbDetails = (await (await request('/integrations/taobao/details', 'POST', {}, token)).json()).data
  assert.equal(tbDetails.fields.find((f) => f.key === 'appSecret').value, testSecret)
  assert.equal(tbDetails.fields.find((f) => f.key === 'adzoneId').value, '678')
  // 淘宝联盟连接测试会请求真实 TOP 网关，集成测试不调用第三方服务；请求与解析由 taobao.test.ts 以模拟响应覆盖
  assert.ok(!(await db.affiliateConfig.findUnique({ where: { accountId: 'taobao-primary' } })).encryptedConfig.includes(testSecret))
  const cfg = await db.affiliateConfig.findUnique({ where: { accountId: 'jd-primary' } })
  assert.ok(!cfg.encryptedConfig.includes(testSecret))
  await request('/integrations/jd', 'PUT', { appSecret: '', positionId: '201' }, token)
  assert.equal(
    (await (await request('/integrations/jd', 'GET', undefined, token)).json()).data.fields.find(
      (f) => f.key === 'appSecret',
    ).configured,
    true,
  )
  await request('/settings', 'PUT', { ratio: 65, minimum: 20 }, token)
  await stop()
  await start()
  assert.equal((await (await request('/settings', 'GET', undefined, token)).json()).data.ratio, 65)
  assert.equal(
    (await (await request('/integrations/jd', 'GET', undefined, token)).json()).data.fields.find(
      (f) => f.key === 'positionId',
    ).value,
    '201',
  )
  const user = await db.user.create({
    data: { name: '仅隔离测试', wallet: { create: { availableCents: 3000n, frozenCents: 2000n } } },
  })
  const order = await db.affiliateOrder.create({
    data: {
      platform: 'jd',
      accountId: 'jd-primary',
      externalOrderId: '9007199254740993101',
      externalLineId: 'line-1',
      status: 'COMPLETED',
      rawStatus: 'test',
      rawData: {},
      amountCents: 10000n,
      paidAmountCents: 9000n,
      rebateCents: 700n,
      ruleSnapshot: { basisPoints: 7000 },
      placedAt: new Date('2026-10-16T01:02:03Z'),
      completedAt: new Date('2026-10-16T02:03:04Z'),
      items: { create: { sku: '1', title: '隔离测试商品', quantity: 1, amountCents: 10000n } },
    },
  })
  const row = (await (await request('/orders', 'GET', undefined, token)).json()).data[0]
  assert.equal(row.platform, '京东')
  assert.equal(row.amount, 10000)
  assert.equal(row.paidAmount, 9000)
  assert.equal(row.ratio, 70)
  assert.equal(row.externalOrderId, '9007199254740993101')
  assert.equal(row.createdAt, '2026-10-16 09:02:03')
  assert.equal(row.completedAt, '2026-10-16 10:03:04')
  const w = await db.withdrawalRequest.create({
    data: {
      userId: user.id,
      idempotencyKey: 'test-w',
      amountCents: 2000n,
      encryptedPayee: 'isolated-test',
      status: 'PENDING_REVIEW',
    },
  })
  assert.equal((await request('/withdrawals/' + w.id + '/approve', 'POST', {}, token)).status, 201)
  assert.equal((await request('/withdrawals/' + w.id + '/confirm-payment', 'POST', {}, token)).status, 400)
  const paid = await Promise.all(
    [1, 2].map(() =>
      request('/withdrawals/' + w.id + '/confirm-payment', 'POST', { proof: 'TEST-ONLY-PROOF' }, token),
    ),
  )
  assert.equal(paid.filter((r) => r.status === 201).length, 1)
  const wallet = await db.walletAccount.findUnique({ where: { userId: user.id } })
  assert.equal(wallet.frozenCents, 0n)
  assert.equal(wallet.withdrawnCents, 2000n)
  assert.equal(await db.walletTransaction.count(), 2)
  const logs = await db.auditLog.findMany()
  assert.ok(!JSON.stringify(logs).includes(testSecret))
  await stop()
  process.env.DATABASE_URL = url.toString()
  const { db: workerDb } = await import('../apps/server/dist/database.js')
  const { jdPlugin, normalizeOrder } = await import('../apps/server/dist/platforms/jd/index.js')
  const { startOrderSync, processOrderSync, orderSyncStatus } = await import('../apps/server/dist/order-sync.js')
  const originalQuery = jdPlugin.queryOrders
  try {
    let calls = 0
    jdPlugin.queryOrders = async () => {
      calls++
      return { rows: [], hasMore: false }
    }
    await assert.rejects(() => startOrderSync('test', 'test', { hours: 2161 }))
    const jobs = await Promise.all([
      startOrderSync('test', 'test', { hours: 2 }),
      startOrderSync('test', 'test', { hours: 2 }),
    ])
    assert.equal(jobs[0].id, jobs[1].id)
    // 一次唤起会连续处理多个时段：2 小时 = 2 个时段，一次完成
    await processOrderSync()
    assert.equal((await orderSyncStatus()).windows, 2)
    assert.equal((await orderSyncStatus()).status, 'COMPLETED')
    assert.equal(calls, 2)
    const job = await startOrderSync('test', 'test', { hours: 1 })
    await workerDb.syncJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING', updatedAt: new Date(Date.now() - 180000) },
    })
    await processOrderSync()
    assert.equal((await orderSyncStatus()).status, 'COMPLETED')
    jdPlugin.queryOrders = async () => ({
      rows: [
        normalizeOrder({
          id: 'plugin-line',
          orderId: 'plugin-order',
          skuId: 'plugin-sku',
          skuName: 'isolated',
          orderTime: '2026-10-17 00:00:00',
          finishTime: 0,
          estimateCosPrice: '10',
          estimateFee: '1',
        }),
      ],
      hasMore: false,
    })
    await startOrderSync('test', 'test', { hours: 2 })
    await processOrderSync()
    await processOrderSync()
    assert.equal((await orderSyncStatus()).status, 'COMPLETED')
    const imported = await workerDb.affiliateOrder.findMany({ where: { externalOrderId: 'plugin-order' } })
    assert.equal(imported.length, 1)
    assert.equal(imported[0].amountCents, null)
    assert.equal(imported[0].commissionCents, 100n)
    assert.equal(imported[0].status, 'UNATTRIBUTED')
    assert.equal(imported[0].userId, null)
    const trackingCode = 'a'.repeat(32)
    await workerDb.userTrackingCode.create({ data: { accountId: 'jd-primary', userId: user.id, code: trackingCode } })
    jdPlugin.queryOrders = async () => ({
      rows: [
        normalizeOrder({
          id: 'plugin-line',
          orderId: 'plugin-order',
          skuId: 'plugin-sku',
          skuName: 'isolated',
          orderTime: '2026-10-17 00:00:00',
          finishTime: 0,
          estimateCosPrice: '10',
          estimateFee: '1',
          subUnionId: trackingCode,
        }),
      ],
      hasMore: false,
    })
    await startOrderSync('test', 'test', { hours: 1 })
    await processOrderSync()
    assert.equal((await workerDb.affiliateOrder.findUnique({ where: { id: imported[0].id } })).userId, null)
    await workerDb.promotionRecord.create({
      data: {
        userId: user.id,
        channelId: 'admin',
        accountId: 'jd-primary',
        trackingCode,
        sourceUrl: 'https://item.jd.com/1.html',
        promotionUrl: 'https://u.jd.com/test',
        status: 'SUCCESS',
      },
    })
    await startOrderSync('test', 'test', { hours: 1 })
    await processOrderSync()
    assert.equal((await workerDb.affiliateOrder.findUnique({ where: { id: imported[0].id } })).userId, user.id)

    jdPlugin.queryOrders = async () => {
      throw new Error('isolated upstream failure')
    }
    await startOrderSync('test', 'test', { hours: 1 })
    await processOrderSync()
    assert.equal((await orderSyncStatus()).status, 'FAILED')
    assert.equal((await orderSyncStatus()).error, 'isolated upstream failure')
  } finally {
    jdPlugin.queryOrders = originalQuery
    await workerDb.$disconnect()
  }
  console.log(
    'PASS: 真实 PostgreSQL 空列表、密码认证、RBAC、配置加密/脱敏/保留、进程重启持久化、订单全部字段与秒级时间、并发打款幂等、资金流水、审计无密钥。',
  )
} finally {
  await stop()
  await db.$disconnect()
  if (!/^test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unexpected test schema')
  await root.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE')
  await root.$disconnect()
}
