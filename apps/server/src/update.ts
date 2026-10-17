// 一键更新（参考 assast/outlookEmail）：容器挂载宿主机 /var/run/docker.sock 后，
// 通过 Docker Engine API 临时启动 watchtower（--run-once），拉取当前标签的新镜像并按原配置重建本容器。
// 本进程会在更新过程中被替换，因此状态写入 DATA_DIR/update-state.json，重启后据版本号判断结果。
import { request } from 'node:http'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common'
import { version as appVersion } from './version'

const socketPath = process.env.UPDATE_DOCKER_SOCKET || '/var/run/docker.sock'
const watchtowerImage = process.env.UPDATE_WATCHTOWER_IMAGE || 'containrrr/watchtower:latest'
const stateFile = join(process.env.DATA_DIR || resolve(__dirname, '../../../data'), 'update-state.json')
const disabled = process.env.UPDATE_ENABLED === 'false'

type State = {
  running: boolean
  fromVersion?: string
  startedAt?: string
  finishedAt?: string
  success?: boolean | null
  message?: string
  log?: string
}
let state: State = { running: false }
state = load()

function load(): State {
  try {
    const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as State
    if (saved.running) {
      // 进程被替换后重新启动：版本变化即更新成功；超过 15 分钟仍未变化视为失败
      if (saved.fromVersion && saved.fromVersion !== appVersion.version)
        return persist({ ...saved, running: false, success: true, finishedAt: new Date().toISOString(), message: `已从 v${saved.fromVersion} 更新到 v${appVersion.version}` })
      if (Date.now() - Date.parse(saved.startedAt || '') > 15 * 60000)
        return persist({ ...saved, running: false, success: false, finishedAt: new Date().toISOString(), message: '更新未完成：服务已重启但版本未变化，请查看 watchtower 日志' })
    }
    return saved
  } catch {
    return { running: false }
  }
}
function persist(next: State) {
  state = next
  try {
    mkdirSync(dirname(stateFile), { recursive: true })
    writeFileSync(stateFile, JSON.stringify(next, null, 2))
  } catch {}
  return next
}

function docker(method: string, path: string, body?: unknown, timeout = 30000) {
  return new Promise<{ status: number; text: string }>((ok, fail) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = request(
      { socketPath, path, method, timeout, headers: { Host: 'docker', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (text += c))
        res.on('end', () => ok({ status: res.statusCode || 0, text }))
        res.on('error', fail)
      },
    )
    req.on('timeout', () => req.destroy(new Error('Docker API 请求超时')))
    req.on('error', fail)
    req.end(data)
  })
}
let apiPrefix = ''
async function api(method: string, path: string, body?: unknown, timeout?: number) {
  if (!apiPrefix) {
    const v = await docker('GET', '/version')
    const parsed = JSON.parse(v.text || '{}') as { ApiVersion?: string }
    if (v.status !== 200 || !parsed.ApiVersion) throw new Error(`无法读取 Docker 版本：HTTP ${v.status}`)
    apiPrefix = `/v${parsed.ApiVersion}`
  }
  return docker(method, apiPrefix + path, body, timeout)
}

async function self() {
  const ref = process.env.UPDATE_CONTAINER || hostname()
  const r = await api('GET', `/containers/${encodeURIComponent(ref)}/json`)
  if (r.status !== 200) throw new Error(`找不到当前容器 ${ref}（HTTP ${r.status}），可设置 UPDATE_CONTAINER 为容器名`)
  const info = JSON.parse(r.text) as { Name: string; Config: { Image: string } }
  return { name: info.Name.replace(/^\//, ''), image: info.Config.Image }
}
const repository = (image: string) => image.replace(/^docker\.io\//, '').replace(/@.*$/, '').replace(/:[^/]+$/, '')
const tagOf = (image: string) => (/:([^/]+)$/.exec(image.replace(/@.*$/, ''))?.[1] || 'latest')
const semver = (v: string) => v.split('.').map(Number)
const newer = (a: string, b: string) => {
  const x = semver(a), y = semver(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

let latestCache: { at: number; repo: string; version: string | null; error?: string } | null = null
async function latestVersion(repo: string) {
  if (latestCache && latestCache.repo === repo && Date.now() - latestCache.at < 10 * 60000) return latestCache
  try {
    const [namespace, name] = repo.includes('/') ? repo.split('/') : ['library', repo]
    const res = await fetch(`https://hub.docker.com/v2/namespaces/${namespace}/repositories/${name}/tags?page_size=100&ordering=last_updated`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`Docker Hub HTTP ${res.status}`)
    const tags = ((await res.json()) as { results?: { name: string }[] }).results || []
    const versions = tags.map((t) => t.name).filter((t) => /^\d+\.\d+\.\d+$/.test(t))
    const version = versions.reduce<string | null>((max, v) => (!max || newer(v, max) ? v : max), null)
    latestCache = { at: Date.now(), repo, version }
  } catch (e) {
    latestCache = { at: Date.now(), repo, version: null, error: e instanceof Error ? e.message : '查询失败' }
  }
  return latestCache
}

async function dockerStatus() {
  if (disabled) return { available: false, reason: '已通过 UPDATE_ENABLED=false 关闭一键更新' }
  if (!existsSync(socketPath)) return { available: false, reason: `未挂载 Docker socket（${socketPath}），请在 compose 中加入 - /var/run/docker.sock:/var/run/docker.sock` }
  try {
    const c = await self()
    if (/^v?\d+\.\d+\.\d+/.test(tagOf(c.image)))
      return { available: false, reason: `当前镜像固定为版本标签 ${c.image}，一键更新需使用 latest 标签；也可修改 compose 中的版本号后重新部署`, ...c }
    return { available: true, reason: '', ...c }
  } catch (e) {
    return { available: false, reason: e instanceof Error && /EACCES/.test(e.message) ? '无权访问 Docker socket' : (e as Error).message }
  }
}

export async function updateStatus() {
  const docker = await dockerStatus()
  const latest = await latestVersion(repository(('image' in docker && docker.image) || 'sunqz/shop-cashback'))
  return {
    current: appVersion,
    latest: latest.version,
    latestError: latest.error || null,
    hasUpdate: !!latest.version && newer(latest.version, appVersion.version),
    docker,
    state,
  }
}

export async function startUpdate() {
  if (state.running) throw new ConflictException('更新正在进行中')
  const docker = await dockerStatus()
  if (!docker.available || !('name' in docker)) throw new BadRequestException(docker.reason)
  persist({ running: true, fromVersion: appVersion.version, startedAt: new Date().toISOString(), success: null, message: '正在拉取 watchtower 镜像', log: '' })
  void runUpdate(docker.name!).catch((e) =>
    persist({ ...state, running: false, success: false, finishedAt: new Date().toISOString(), message: `更新失败：${e instanceof Error ? e.message : e}` }),
  )
  return state
}

async function runUpdate(container: string) {
  const [image, tag = 'latest'] = watchtowerImage.split(/:(?=[^/]+$)/)
  const pull = await api('POST', `/images/create?fromImage=${encodeURIComponent(image)}&tag=${encodeURIComponent(tag)}`, undefined, 300000)
  const pullError = pull.text.split('\n').map((l) => { try { return JSON.parse(l).error } catch { return null } }).find(Boolean)
  if (pull.status !== 200 || pullError) throw new ServiceUnavailableException(`拉取 ${watchtowerImage} 失败：${pullError || `HTTP ${pull.status}`}`)

  persist({ ...state, message: '正在启动更新任务' })
  const created = await api('POST', `/containers/create?name=shop-cashback-updater-${Date.now()}`, {
    Image: watchtowerImage,
    Cmd: ['--run-once', '--cleanup', container],
    Tty: true,
    Env: [`DOCKER_API_VERSION=${apiPrefix.slice(2)}`],
    HostConfig: { AutoRemove: true, Binds: [`${socketPath}:/var/run/docker.sock`] },
  })
  if (created.status !== 201) throw new Error(`创建更新容器失败：HTTP ${created.status} ${created.text}`)
  const id = (JSON.parse(created.text) as { Id: string }).Id
  const started = await api('POST', `/containers/${id}/start`)
  if (started.status !== 204 && started.status !== 304) throw new Error(`启动更新容器失败：HTTP ${started.status} ${started.text}`)
  persist({ ...state, message: '正在拉取新镜像，发现新版本后服务会自动重启' })

  // 若有新镜像，本容器会被停止替换，下面的代码不会执行完；没有新镜像时 watchtower 正常退出
  const logs = await api('GET', `/containers/${id}/logs?stdout=1&stderr=1&follow=1&tail=200`, undefined, 15 * 60000)
  const log = logs.text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim().split('\n').slice(-15).join('\n')
  const updated = Number(/Updated=(\d+)/.exec(log)?.[1] || 0)
  const failed = Number(/Failed=(\d+)/.exec(log)?.[1] || 0)
  persist({
    ...state,
    running: false,
    finishedAt: new Date().toISOString(),
    success: failed === 0,
    log,
    message: failed
      ? '更新失败，请查看下方日志'
      : updated
        ? '新镜像已就绪，服务即将重启'
        : '已是最新镜像，无需更新（如刚推送代码，请等待 GitHub Actions 构建完成后重试）',
  })
}
