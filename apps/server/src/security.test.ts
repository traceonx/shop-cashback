import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createCipheriv, createHash } from 'node:crypto'
import { encrypt, decrypt, hashPassword, verifyPassword } from './security'
import { decryptCallback, xmlObject } from './wecom'
import { parseJdJson, jdDate, decimalCents } from './integrations'
test('平台长订单号精确解析，不将计佣小数浮点计入余额', () => {
  assert.equal(parseJdJson('{"orderId":9007199254740993101}').orderId, '9007199254740993101')
  assert.equal(decimalCents('12.3456'), 1234)
  assert.equal(decimalCents('bad'), null)
})
test('京东时间按北京时间解析，空完成时间不伪造', () => {
  assert.equal(jdDate('2026-10-16 09:02:03')?.toISOString(), '2026-10-16T01:02:03.000Z')
  assert.equal(jdDate(0), null)
  assert.equal(jdDate('invalid'), null)
})
test('配置使用认证加密，错误上下文或篡改不可解密', () => {
  const value = { secret: 'only-test-secret' },
    encoded = encrypt(value, 'test')
  assert.ok(!encoded.includes(value.secret))
  assert.deepEqual(decrypt(encoded, 'test'), value)
  assert.throws(() => decrypt(encoded, 'other'))
  const parts = encoded.split('.')
  const body = Buffer.from(parts[2], 'base64')
  body[0] ^= 1
  parts[2] = body.toString('base64')
  assert.throws(() => decrypt(parts.join('.'), 'test'))
})
test('密码哈希不存明文，拒绝错误密码', () => {
  const hash = hashPassword('test-password-for-unit')
  assert.ok(!hash.includes('test-password'))
  assert.equal(verifyPassword('test-password-for-unit', hash), true)
  assert.equal(verifyPassword('wrong', hash), false)
})
test('企业微信回调验签、AES 解密、企业归属及重放时间校验', () => {
  const key = randomBytes(32),
    cfg = { corpId: 'test-corp', token: 'test-token', aesKey: key.toString('base64').replace(/=$/, '') },
    plain = Buffer.from('真实回调测试'),
    len = Buffer.alloc(4)
  len.writeUInt32BE(plain.length)
  const raw = Buffer.concat([randomBytes(16), len, plain, Buffer.from(cfg.corpId)]),
    pad = 32 - (raw.length % 32),
    cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  const encrypted = Buffer.concat([
      cipher.update(Buffer.concat([raw, Buffer.alloc(pad, pad)])),
      cipher.final(),
    ]).toString('base64'),
    timestamp = String(Math.floor(Date.now() / 1000)),
    nonce = 'unit-nonce',
    signature = createHash('sha1').update([cfg.token, timestamp, nonce, encrypted].sort().join('')).digest('hex')
  assert.equal(decryptCallback(cfg, signature, timestamp, nonce, encrypted), plain.toString())
  assert.throws(() => decryptCallback(cfg, '0'.repeat(40), timestamp, nonce, encrypted))
  assert.throws(() => decryptCallback({ ...cfg, corpId: 'wrong' }, signature, timestamp, nonce, encrypted))
  assert.throws(() => decryptCallback(cfg, signature, '1', nonce, encrypted))
  assert.throws(() => xmlObject('<!DOCTYPE xml [<!ENTITY x SYSTEM "file:///private">]><xml/>'))
})
