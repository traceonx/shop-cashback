import { existsSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
if (existsSync('.env')) throw new Error('.env 已存在，未覆盖')
const dbPassword = randomBytes(24).toString('hex')
writeFileSync(
  '.env',
  `NODE_ENV=development\nPORT=3001\nHOST=127.0.0.1\nPOSTGRES_PASSWORD=${dbPassword}\nDATABASE_URL=postgresql://rebate:${dbPassword}@127.0.0.1:54329/rebate\nJWT_SECRET=${randomBytes(48).toString('hex')}\nCONFIG_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`,
  { mode: 0o600 },
)
console.log('已生成本地服务密钥（未输出）。请在后台页面创建管理员用户名和密码。')
