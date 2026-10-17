import { config } from 'dotenv'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
const root = existsSync(resolve(process.cwd(), 'prisma/schema.prisma')) ? process.cwd() : resolve(__dirname, '../../..')
config({ path: resolve(root, '.env'), quiet: true })
export const env = process.env
export function requireEnv(key: string) {
  const value = env[key]
  if (!value) throw new Error(`缺少服务端配置 ${key}`)
  return value
}
