import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureUserAdzone, isAdzoneCode, parseAdzonePool, userPid, type AdzoneStore } from './platforms/taobao/adzones'
import { normalizeTaobaoOrder } from './platforms/taobao/orders'

const official = { pid: 'mm_133091730_45556678_621564417', adzoneId: '621564417' }
const third = { enabled: 'true', apiKey: 'k', tbname: '影空幻灭者' }
const memStore = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  const store: AdzoneStore = {
    find: async (u) => m.get(u) ?? null,
    used: async () => new Set(m.values()),
    save: async (u, z) => {
      if ([...m.entries()].some(([k, v]) => v === z && k !== u)) return false
      m.set(u, z)
      return true
    },
  }
  return { m, store }
}

test('首次转链创建推广位并保存，之后复用；并发只创建一次', async () => {
  const { m, store } = memStore()
  const calls: Record<string, string>[] = []
  const create = async (p: Record<string, string>) => {
    calls.push(p)
    await new Promise((r) => setTimeout(r, 10))
    return { model: 'mm_133091730_45556678_1000001' }
  }
  const [a, b] = await Promise.all([
    ensureUserAdzone(store, official, third, 'user-aaaaaaaa-1', create),
    ensureUserAdzone(store, official, third, 'user-aaaaaaaa-1', create),
  ])
  assert.equal(a, '1000001')
  assert.equal(b, '1000001')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].site_id, '45556678')
  assert.equal(m.get('user-aaaaaaaa-1'), '1000001')
  assert.equal(await ensureUserAdzone(store, official, third, 'user-aaaaaaaa-1', create), '1000001')
  assert.equal(calls.length, 1)
  assert.equal(userPid(official, '1000001'), 'mm_133091730_45556678_1000001')
})

test('旧版随机标识会被替换；返回其他账号或网站的 PID 时拒绝', async () => {
  const { m, store } = memStore({ u1: 'ab12cd34ef56ab12cd34ef56ab12cd34' })
  assert.equal(isAdzoneCode('ab12cd34ef56ab12cd34ef56ab12cd34'), false)
  assert.equal(await ensureUserAdzone(store, official, third, 'u1', async () => ({ model: 'mm_133091730_45556678_222' })), '222')
  assert.equal(m.get('u1'), '222')
  await assert.rejects(ensureUserAdzone(store, official, third, 'u2', async () => ({ model: 'mm_999_45556678_333' })))
  await assert.rejects(ensureUserAdzone(store, official, third, 'u3', async () => ({ model: 'mm_133091730_1_333' })))
  assert.equal(m.has('u2'), false)
})

test('先从推广位池分配，每人一个且不重复；池子用完再自动创建', async () => {
  const pooled = { ...official, adzonePool: 'mm_133091730_45556678_501\nmm_133091730_9_502' }
  const { m, store } = memStore()
  let created = 0
  const create = async () => ({ model: `mm_133091730_45556678_${900 + ++created}` })
  const [a, b] = await Promise.all([
    ensureUserAdzone(store, pooled, third, 'A', create),
    ensureUserAdzone(store, pooled, third, 'B', create),
  ])
  assert.deepEqual([a, b].sort(), ['501', '502'])
  assert.equal(created, 0)
  assert.equal(await ensureUserAdzone(store, pooled, third, 'C', create), '901')
  assert.equal(await ensureUserAdzone(store, pooled, null, 'D', create), null)
  assert.equal(m.size, 3)
  // 不同网站的池中推广位按池里的 PID 转链
  assert.equal(userPid(pooled, '502'), 'mm_133091730_9_502')
  assert.equal(userPid(pooled, '901'), 'mm_133091730_45556678_901')
})

test('推广位池校验：格式、账号、默认推广位、去重', () => {
  assert.equal(parseAdzonePool('mm_133091730_45556678_1, mm_133091730_45556678_1\nmm_133091730_45556678_2', official).length, 2)
  assert.throws(() => parseAdzonePool('abc', official, true))
  assert.throws(() => parseAdzonePool('mm_1_2_3', official, true))
  assert.throws(() => parseAdzonePool(official.pid, official, true))
})

test('未配置喵有券或 PID 不完整时不创建', async () => {
  const { store } = memStore()
  const create = async () => assert.fail('不应调用')
  assert.equal(await ensureUserAdzone(store, { pid: 'mm_1_2' }, third, 'u', create), null)
  assert.equal(await ensureUserAdzone(store, official, { apiKey: '', tbname: 'x' }, 'u', create), null)
})

test('订单的推广位 ID 作为用户标识', () => {
  const raw = { trade_parent_id: '123', trade_id: '456', tk_create_time: '2026-10-19 10:00:00', alipay_total_price: '10.00', tk_status: '12', adzone_id: 1000001 }
  assert.equal(normalizeTaobaoOrder(raw).trackingCode, '1000001')
  assert.equal(normalizeTaobaoOrder({ ...raw, adzone_id: undefined }).trackingCode, null)
})
