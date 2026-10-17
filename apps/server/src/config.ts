import { config } from 'dotenv'
import { resolve, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
const root = existsSync(resolve(process.cwd(), 'prisma/schema.prisma')) ? process.cwd() : resolve(__dirname, '../../..')
config({ path: resolve(root, '.env'), quiet: true })
export const env = process.env

// JWT_SECRET / CONFIG_ENCRYPTION_KEY 未通过环境变量提供时，首次启动自动生成并保存在 DATA_DIR/secrets.json，
// 之后每次启动复用。该文件必须与数据库一起持久化和备份：丢失后已保存的平台凭证无法解密。
const generated = { JWT_SECRET: () => randomBytes(48).toString('hex'), CONFIG_ENCRYPTION_KEY: () => randomBytes(32).toString('hex') }
const missing = (Object.keys(generated) as (keyof typeof generated)[]).filter((k) => !env[k])
if (missing.length) {
  const dir = env.DATA_DIR || resolve(root, 'data'),
    file = join(dir, 'secrets.json')
  const saved: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  let changed = false
  for (const key of missing) {
    if (!saved[key]) {
      saved[key] = generated[key]()
      changed = true
    }
    env[key] = saved[key]
  }
  if (changed) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 })
    console.log(`已自动生成 ${missing.join('、')} 并保存到 ${file}，请与数据库一起备份。`)
  }
}

export function requireEnv(key: string) {
  const value = env[key]
  if (!value) throw new Error(`缺少服务端配置 ${key}`)
  return value
}
