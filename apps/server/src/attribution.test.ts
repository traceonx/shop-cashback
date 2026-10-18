import { test } from 'node:test'
import assert from 'node:assert/strict'

test('找回订单指令格式', () => {
  const re = /^\/?找回\s*\d{8,24}$/
  assert.ok(re.test('找回 312345678901'))
  assert.ok(re.test('/找回312345678901'))
  assert.ok(!re.test('找回 abc'))
  assert.ok(!re.test('312345678901'))
})
