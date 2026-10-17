import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 版本号唯一来源：根目录 package.json；镜像构建时通过 APP_VERSION / GIT_SHA / BUILD_TIME 注入。
function packageVersion() {
  for (const dir of [process.cwd(), resolve(__dirname, '../../..')]) {
    const file = resolve(dir, 'package.json')
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string }
      if (pkg.name === 'shop-cashback' && pkg.version) return pkg.version
    }
  }
  return 'unknown'
}
export const version = {
  version: process.env.APP_VERSION || packageVersion(),
  commit: (process.env.GIT_SHA || 'dev').slice(0, 7),
  builtAt: process.env.BUILD_TIME || null,
}
export const versionText = () =>
  `拾惠返利 v${version.version}（提交 ${version.commit}${version.builtAt ? `，构建于 ${version.builtAt}` : ''}）`
