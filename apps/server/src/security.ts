import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { requireEnv } from './config'
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}
export function verifyPassword(password: string, hash: string) {
  const [salt, value] = hash.split(':')
  if (!salt || !value) return false
  const expected = Buffer.from(value, 'hex'),
    actual = scryptSync(password, salt, 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
function key() {
  const raw = requireEnv('CONFIG_ENCRYPTION_KEY')
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error('CONFIG_ENCRYPTION_KEY 必须是 32 字节十六进制值')
  return Buffer.from(raw, 'hex')
}
export function encrypt(value: unknown, context: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(context))
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}
export function decrypt<T>(value: string, context: string): T {
  const [iv, tag, data] = value.split('.').map((v) => Buffer.from(v, 'base64'))
  const cipher = createDecipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(context))
  cipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')) as T
}
