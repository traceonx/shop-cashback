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

type Phase = 'prepare' | 'pull' | 'recreate' | 'restarting'
type Progress = { percent: number; current: number; total: number; layers: number; done: number }
type State = {
  running: boolean
  phase?: Phase
  progress?: Progress
  fromVersion?: string
  startedAt?: string
  updatedAt?: string
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
        return persist({ ...saved, running: false, phase: undefined, success: true, finishedAt: new Date().toISOString(), message: `已从 v${saved.fromVersion} 更新到 v${appVersion.version}` })
      if (saved.phase === 'restarting')
        return persist({ ...saved, running: false, phase: undefined, success: true, finishedAt: new Date().toISOString(), message: `已使用新镜像重启（当前 v${appVersion.version}）` })
      if (saved.phase === 'pull' || saved.phase === 'prepare')
        return persist({ ...saved, running: false, phase: undefined, success: false, finishedAt: new Date().toISOString(), message: '更新被中断（服务在下载镜像时重启），请重试' })
      if (Date.now() - Date.parse(saved.startedAt || '') > 15 * 60000)
        return persist({ ...saved, running: false, success: false, finishedAt: new Date().toISOString(), message: '更新未完成：服务已重启但版本未变化，请查看 watchtower 日志' })
    }
    return saved
  } catch {
    return { running: false }
  }
}
let lastWrite = 0
function persist(next: State, throttle = false) {
  if (next.message && next.message !== state.message) console[next.success === false ? 'warn' : 'log'](`[一键更新] ${next.message}`)
  state = { ...next, updatedAt: new Date().toISOString() }
  next = state
  if (throttle && Date.now() - lastWrite < 1000) return next
  lastWrite = Date.now()
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
// 流式请求：逐行回调 JSON；超过 idleMs 没有任何数据视为卡住
function dockerStream(method: string, path: string, onLine: (line: Record<string, any>) => void, idleMs = 180000) {
  return new Promise<number>((ok, fail) => {
    const req = request({ socketPath, path, method, headers: { Host: 'docker' } }, (res) => {
      let buffer = ''
      let idle = setTimeout(() => req.destroy(new Error('长时间没有下载进度，请检查 NAS 的网络或 Docker 镜像加速配置')), idleMs)
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        clearTimeout(idle)
        idle = setTimeout(() => req.destroy(new Error('长时间没有下载进度，请检查 NAS 的网络或 Docker 镜像加速配置')), idleMs)
        buffer += chunk
        let i: number
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim()
          buffer = buffer.slice(i + 1)
          if (line) try { onLine(JSON.parse(line)) } catch {}
        }
      })
      res.on('end', () => { clearTimeout(idle); ok(res.statusCode || 0) })
      res.on('error', (e) => { clearTimeout(idle); fail(e) })
    })
    req.on('error', fail)
    req.end()
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

// 识别当前容器：UPDATE_CONTAINER → /proc/self/mountinfo 中的完整容器 ID → 主机名 → 唯一运行本镜像的容器
function containerIdFromMounts() {
  try {
    return /\/containers\/([0-9a-f]{64})\//.exec(readFileSync('/proc/self/mountinfo', 'utf8'))?.[1]
  } catch {
    return undefined
  }
}
async function inspect(ref: string) {
  const r = await api('GET', `/containers/${encodeURIComponent(ref)}/json`)
  if (r.status !== 200) return null
  const info = JSON.parse(r.text) as { Name: string; Config: { Image: string } }
  return { name: info.Name.replace(/^\//, ''), image: info.Config.Image }
}
async function self() {
  if (process.env.UPDATE_CONTAINER) {
    const found = await inspect(process.env.UPDATE_CONTAINER)
    if (found) return found
    throw new Error(`找不到 UPDATE_CONTAINER 指定的容器 ${process.env.UPDATE_CONTAINER}`)
  }
  for (const ref of [containerIdFromMounts(), hostname()]) {
    const found = ref && (await inspect(ref))
    if (found) return found
  }
  const list = await api('GET', '/containers/json')
  const mine = (JSON.parse(list.text || '[]') as { Names: string[]; Image: string }[]).filter((c) => /(^|\/)shop-cashback(:|@|$)/.test(c.Image))
  if (mine.length === 1) return { name: mine[0].Names[0].replace(/^\//, ''), image: mine[0].Image }
  throw new Error(`无法识别当前容器（主机名 ${hostname()}${mine.length > 1 ? `，发现 ${mine.length} 个本项目容器` : ''}），请在 compose 中设置 UPDATE_CONTAINER 为容器名`)
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
    // UPDATE_HUB_API：可选，hub.docker.com 的反向代理基址（与企业微信代理同理），国内网络无法直连时使用
    const base = (process.env.UPDATE_HUB_API || 'https://hub.docker.com').replace(/\/+$/, '')
    const res = await fetch(`${base}/v2/namespaces/${namespace}/repositories/${name}/tags?page_size=100&ordering=last_updated`, { signal: AbortSignal.timeout(10000) })
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

// 通过本机 Docker 守护进程比对远程镜像摘要：走守护进程已配置的镜像加速 / 代理，不依赖 hub.docker.com 网页接口
let digestCache: { at: number; image: string; changed: boolean | null; error?: string } | null = null
async function remoteImageChanged(image: string) {
  if (digestCache && digestCache.image === image && Date.now() - digestCache.at < 10 * 60000) return digestCache
  try {
    const local = await api('GET', `/images/${encodeURIComponent(image)}/json`)
    if (local.status !== 200) throw new Error(`读取本地镜像失败：HTTP ${local.status}`)
    const digests = ((JSON.parse(local.text) as { RepoDigests?: string[] }).RepoDigests || []).map((d) => d.split('@')[1])
    const remote = await api('GET', `/distribution/${image.split('/').map(encodeURIComponent).join('/')}/json`, undefined, 20000)
    if (remote.status !== 200) throw new Error(`查询远程镜像失败：HTTP ${remote.status}`)
    const digest = (JSON.parse(remote.text) as { Descriptor?: { digest?: string } }).Descriptor?.digest
    if (!digest) throw new Error('远程镜像摘要为空')
    digestCache = { at: Date.now(), image, changed: !digests.includes(digest) }
  } catch (e) {
    digestCache = { at: Date.now(), image, changed: null, error: e instanceof Error ? e.message : '查询失败' }
  }
  return digestCache
}

export async function updateStatus() {
  const docker = await dockerStatus()
  const image = ('image' in docker && docker.image) || 'sunqz/shop-cashback:latest'
  const [latest, remote] = await Promise.all([
    latestVersion(repository(image)),
    docker.available ? remoteImageChanged(image) : Promise.resolve(null),
  ])
  return {
    current: appVersion,
    latest: latest.version,
    latestError: latest.error ? `无法访问 Docker Hub（${latest.error}），可设置 UPDATE_HUB_API 代理` : null,
    imageChanged: remote?.changed ?? null,
    imageError: remote?.error || null,
    hasUpdate: (!!latest.version && newer(latest.version, appVersion.version)) || remote?.changed === true,
    docker,
    state,
  }
}

export async function startUpdate() {
  if (state.running) throw new ConflictException('更新正在进行中')
  const docker = await dockerStatus()
  if (!docker.available || !('name' in docker)) throw new BadRequestException(docker.reason)
  persist({ running: true, phase: 'prepare', fromVersion: appVersion.version, startedAt: new Date().toISOString(), success: null, message: '正在准备更新', log: '' })
  void runUpdate(docker.name!, docker.image!).catch((e) =>
    persist({ ...state, running: false, phase: undefined, success: false, finishedAt: new Date().toISOString(), message: `更新失败：${e instanceof Error ? e.message : e}` }),
  )
  return state
}

const splitImage = (ref: string) => {
  const clean = ref.replace(/@.*$/, '')
  const m = /^(.*?)(?::([^/:]+))?$/.exec(clean)!
  return { repo: m[1], tag: m[2] || 'latest' }
}
// 通过守护进程拉取镜像（走 NAS 已配置的镜像加速），按层汇总下载 / 解压进度
async function pullWithProgress(ref: string, onProgress?: (p: Progress) => void) {
  const { repo, tag } = splitImage(ref)
  const layers = new Map<string, { current: number; total: number; done: boolean }>()
  let error = ''
  const status = await dockerStream('POST', `${apiPrefix}/images/create?fromImage=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`, (line) => {
    if (line.error) error = String(line.error)
    if (!line.id || !onProgress) return
    const layer = layers.get(line.id) || { current: 0, total: 0, done: false }
    const st = String(line.status || '')
    if (st === 'Downloading' && line.progressDetail?.total) {
      layer.total = line.progressDetail.total
      layer.current = line.progressDetail.current || 0
    } else if (/Download complete|Pull complete|Already exists/.test(st)) {
      layer.current = layer.total
      if (/Pull complete|Already exists/.test(st)) layer.done = true
    } else if (st === 'Extracting' && line.progressDetail?.total) {
      layer.total = layer.total || line.progressDetail.total
      layer.current = layer.total
    }
    if (/Pulling fs layer|Waiting|Downloading|Download complete|Extracting|Pull complete|Already exists|Verifying/.test(st)) layers.set(line.id, layer)
    const all = [...layers.values()]
    const total = all.reduce((n, l) => n + l.total, 0), current = all.reduce((n, l) => n + l.current, 0)
    const done = all.filter((l) => l.done).length
    // 下载占 85%，解压完成层数占 15%
    const percent = all.length ? Math.min(99, Math.round((total ? (current / total) * 85 : 0) + (done / all.length) * 15)) : 0
    onProgress({ percent, current, total, layers: all.length, done })
  })
  if (status !== 200 || error) throw new ServiceUnavailableException(`拉取 ${ref} 失败：${error || `HTTP ${status}`}`)
}

async function runUpdate(container: string, image: string) {
  const mb = (n: number) => (n / 1048576).toFixed(1)
  persist({ ...state, phase: 'pull', progress: { percent: 0, current: 0, total: 0, layers: 0, done: 0 }, message: '正在下载新镜像' })
  await pullWithProgress(image, (p) =>
    persist({ ...state, progress: p, message: p.total ? `正在下载新镜像 ${mb(p.current)} / ${mb(p.total)} MB` : '正在下载新镜像' }, true),
  )
  // 比较当前容器使用的镜像与刚拉取的镜像，相同则无需重建
  const [cur, img] = await Promise.all([api('GET', `/containers/${encodeURIComponent(container)}/json`), api('GET', `/images/${encodeURIComponent(image)}/json`)])
  const currentId = (JSON.parse(cur.text || '{}') as { Image?: string }).Image
  const latestId = (JSON.parse(img.text || '{}') as { Id?: string }).Id
  if (currentId && latestId && currentId === latestId) {
    persist({ ...state, running: false, phase: undefined, progress: undefined, success: true, finishedAt: new Date().toISOString(), message: '已是最新镜像，无需更新（如刚推送代码，请等待 GitHub Actions 构建完成后重试）' })
    return
  }

  persist({ ...state, phase: 'recreate', progress: { percent: 100, current: 0, total: 0, layers: 0, done: 0 }, message: '新镜像已下载，正在准备重建容器' })
  await pullWithProgress(watchtowerImage) // 首次需下载 watchtower（约 10MB）
  const created = await api('POST', `/containers/create?name=shop-cashback-updater-${Date.now()}`, {
    Image: watchtowerImage,
    // --no-pull：镜像已由本服务拉取，watchtower 只负责用本地新镜像按原配置重建容器，避免其直连 Docker Hub 卡住
    Cmd: ['--run-once', '--cleanup', '--no-pull', container],
    Tty: true,
    Env: [`DOCKER_API_VERSION=${apiPrefix.slice(2)}`],
    HostConfig: { AutoRemove: true, Binds: [`${socketPath}:/var/run/docker.sock`] },
  })
  if (created.status !== 201) throw new Error(`创建更新容器失败：HTTP ${created.status} ${created.text}`)
  const id = (JSON.parse(created.text) as { Id: string }).Id
  persist({ ...state, phase: 'restarting', message: '正在重建容器，服务即将重启' })
  const started = await api('POST', `/containers/${id}/start`)
  if (started.status !== 204 && started.status !== 304) throw new Error(`启动更新容器失败：HTTP ${started.status} ${started.text}`)

  // 正常情况下本容器会被停止替换，下面的代码执行不到；若 watchtower 失败则记录日志
  const logs = await api('GET', `/containers/${id}/logs?stdout=1&stderr=1&follow=1&tail=200`, undefined, 10 * 60000)
  const log = logs.text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim().split('\n').slice(-15).join('\n')
  const updated = Number(/Updated=(\d+)/.exec(log)?.[1] || 0)
  const failed = Number(/Failed=(\d+)/.exec(log)?.[1] || 0)
  persist({
    ...state,
    running: false,
    phase: undefined,
    finishedAt: new Date().toISOString(),
    success: failed === 0 && updated > 0,
    log,
    message: failed ? '重建容器失败，请查看下方日志' : updated ? '容器已重建，服务即将重启' : 'watchtower 未执行更新，请查看下方日志',
  })
}
