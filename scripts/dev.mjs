// 一条命令启动本地开发环境：npm run dev
// 依次：安装依赖（首次）→ 生成 .env（首次）→ 启动本地 PostgreSQL 容器 → Prisma 生成与迁移 → 同时启动 API 与后台
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const step = (title) => console.log(`\n\x1b[36m▶ ${title}\x1b[0m`)
function run(command, failure) {
  const result = spawnSync(command, { shell: true, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`\n\x1b[31m✖ ${failure}\x1b[0m`)
    process.exit(result.status || 1)
  }
}

if (!existsSync('node_modules')) {
  step('首次运行，安装依赖')
  run('npm ci', '依赖安装失败')
}

if (!existsSync('.env')) {
  step('生成本地 .env（随机密钥）')
  run('node scripts/init-local.mjs', '.env 生成失败')
}

step('启动本地 PostgreSQL（Docker，127.0.0.1:54329）')
if (spawnSync('docker info', { shell: true, stdio: 'ignore' }).status !== 0) {
  console.error('\n\x1b[31m✖ 无法连接 Docker，请先启动 Docker Desktop 后重试\x1b[0m')
  process.exit(1)
}
run('docker compose --env-file .env -f deploy/local-db.yml up -d --wait', '数据库容器启动失败')

step('Prisma 生成客户端并执行迁移')
run('npx prisma generate', 'Prisma 客户端生成失败')
run('npx prisma migrate deploy', '数据库迁移失败')

step('启动 API（http://127.0.0.1:3001）与后台（http://127.0.0.1:5173），Ctrl+C 结束')
const child = spawn('npm run dev:apps', { shell: true, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => {
  console.log('\n已停止前后端；数据库容器仍在后台运行，可用 npm run db:stop 停止（数据保留）。')
  process.exit(code ?? 0)
})
