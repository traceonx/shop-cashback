import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCron, cronMatches, nextCron } from './cron'

// 默认按 Asia/Shanghai（UTC+8）计算
test('解析并匹配 cron 表达式', () => {
  const daily = parseCron('0 4 * * *')
  assert.equal(cronMatches(daily, new Date('2026-10-18T20:00:00Z')), true) // 北京时间 04:00
  assert.equal(cronMatches(daily, new Date('2026-10-18T04:00:00Z')), false)
  assert.equal(nextCron(daily, new Date('2026-10-18T12:00:00Z'))?.toISOString(), '2026-10-18T20:00:00.000Z')
  const every = parseCron('*/30 * * * *')
  assert.equal(cronMatches(every, new Date('2026-10-18T12:30:00Z')), true)
  assert.equal(cronMatches(every, new Date('2026-10-18T12:31:00Z')), false)
  const sunday = parseCron('0 3 * * 7')
  assert.equal(cronMatches(sunday, new Date('2026-10-17T19:00:00Z')), true) // 北京时间周日 03:00
})

test('非法表达式给出中文错误', () => {
  assert.throws(() => parseCron('0 4 * *'), /5 段/)
  assert.throws(() => parseCron('61 * * * *'), /分钟/)
  assert.throws(() => parseCron('0 4 * * abc'), /星期/)
})
