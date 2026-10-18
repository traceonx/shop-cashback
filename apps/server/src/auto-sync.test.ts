import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncDelay } from './auto-sync'

const now = Date.parse('2026-10-18T12:00:00Z')
const ago = (m: number) => new Date(now - m * 60000)

test('按转链活跃度动态调整同步间隔', () => {
  assert.equal(syncDelay({ lastConversionAt: null, activeUsers: 0 }, now), 600000)
  assert.equal(syncDelay({ lastConversionAt: ago(2), activeUsers: 12 }, now), 10000)
  assert.equal(syncDelay({ lastConversionAt: ago(2), activeUsers: 1 }, now), 5000)
  assert.equal(syncDelay({ lastConversionAt: ago(10), activeUsers: 1 }, now), 30000)
  assert.equal(syncDelay({ lastConversionAt: ago(60), activeUsers: 1 }, now), 60000)
  assert.equal(syncDelay({ lastConversionAt: ago(300), activeUsers: 0 }, now), 300000)
  assert.equal(syncDelay({ lastConversionAt: ago(3000), activeUsers: 0 }, now), 600000)
})
