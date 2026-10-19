import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureUserPosition, parsePositionPool, type PositionStore } from './platforms/jd/positions'
import { normalizeOrder } from './platforms/jd/index'

const memStore = () => {
  const byPos = new Map<string, string>()
  const store: PositionStore = {
    find: async (u) => [...byPos.entries()].find(([, v]) => v === u)?.[0] ?? null,
    used: async () => new Set(byPos.keys()),
    save: async (u, p) => {
      if (byPos.has(p)) return false
      byPos.set(p, u)
      return true
    },
    owner: async (p) => byPos.get(p) ?? null,
  }
  return { byPos, store }
}

test('推广位池解析：数字、去重、排除默认推广位', () => {
  assert.deepEqual(parsePositionPool('11, 22\n22 33', ['33']), ['11', '22'])
  assert.throws(() => parsePositionPool('abc', [], true))
  assert.throws(() => parsePositionPool('33', ['33'], true))
})

test('每人固定一个推广位，并发不重复，池子用完返回 null', async () => {
  const { store } = memStore()
  const pool = ['11', '22']
  const [a, b] = await Promise.all([ensureUserPosition(store, pool, 'A'), ensureUserPosition(store, pool, 'B')])
  assert.deepEqual([a, b].sort(), ['11', '22'])
  assert.equal(await ensureUserPosition(store, pool, 'A'), a)
  assert.equal(await ensureUserPosition(store, pool, 'C'), null)
  assert.equal(await store.owner(a!), 'A')
})

test('订单推广位 ID 读取', () => {
  const raw = { id: '1', orderId: '2', actualCosPrice: 10, orderTime: '2026-10-19 10:00:00', validCode: 16, positionId: 3100000001 }
  assert.equal(normalizeOrder(raw).positionId, '3100000001')
  assert.equal(normalizeOrder({ ...raw, positionId: 0 }).positionId, null)
})
