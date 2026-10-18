// 通过 PROXY_HOST 直接从镜像仓库下载镜像（参照 MoviePilot：更新包经系统代理下载），再交给本机 Docker 导入。
// 解决 NAS 上 Docker 守护进程无法访问 Docker Hub、拉取长时间无进度的问题。
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { streamGet } from './proxy'

const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

export type Blob = { digest: string; size: number; mediaType?: string }
export type RemoteImage = { repo: string; tag: string; indexDigest: string | null; manifestDigest: string | null; config: Blob; layers: Blob[]; base: string; auth: Record<string, string> }

/** 仅支持 Docker Hub（含 docker.io/ 前缀或无仓库前缀）的镜像 */
export function parseHubRef(ref: string) {
  const clean = ref.replace(/@.*$/, '').replace(/^docker\.io\//, '').replace(/^index\.docker\.io\//, '')
  const first = clean.split('/')[0]
  if (clean.includes('/') && (first.includes('.') || first.includes(':')) ) return null // 其他仓库
  const m = /^(.*?)(?::([^/:]+))?$/.exec(clean)!
  const repo = m[1].includes('/') ? m[1] : `library/${m[1]}`
  return { repo, tag: m[2] || 'latest' }
}

async function readBody(res: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const c of res) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}
async function getJson(url: string, headers: Record<string, string>) {
  const res = await streamGet('dockerhub', url, headers, 30000)
  const text = await readBody(res)
  return { status: res.statusCode || 0, headers: res.headers, text }
}

/** 按 WWW-Authenticate 获取匿名拉取 token（Docker Hub：auth.docker.io） */
async function authHeaders(base: string, repo: string): Promise<Record<string, string>> {
  const probe = await getJson(`${base}/v2/`, {})
  if (probe.status === 200) return {}
  const challenge = String(probe.headers['www-authenticate'] || '')
  const realm = /realm="([^"]+)"/.exec(challenge)?.[1]
  const service = /service="([^"]+)"/.exec(challenge)?.[1]
  if (!realm) throw new Error(`镜像仓库认证失败（HTTP ${probe.status}）`)
  const q = new URLSearchParams({ scope: `repository:${repo}:pull`, ...(service ? { service } : {}) })
  const res = await getJson(`${realm}?${q}`, {})
  const token = (JSON.parse(res.text || '{}') as { token?: string; access_token?: string })
  const value = token.token || token.access_token
  if (res.status !== 200 || !value) throw new Error(`获取镜像仓库 token 失败（HTTP ${res.status}）`)
  return { Authorization: `Bearer ${value}` }
}

/** 读取远程镜像：多架构清单中选择与本机相同的平台 */
export async function remoteImage(ref: string, arch: string): Promise<RemoteImage> {
  const parsed = parseHubRef(ref)
  if (!parsed) throw new Error('仅支持 Docker Hub 镜像经代理下载')
  const base = (process.env.UPDATE_REGISTRY || 'https://registry-1.docker.io').replace(/\/+$/, '')
  const auth = await authHeaders(base, parsed.repo)
  const get = async (reference: string) => {
    const r = await getJson(`${base}/v2/${parsed.repo}/manifests/${reference}`, { ...auth, Accept: ACCEPT })
    if (r.status !== 200) throw new Error(`读取镜像清单失败（HTTP ${r.status}）：${r.text.slice(0, 120)}`)
    return { json: JSON.parse(r.text), digest: (r.headers['docker-content-digest'] as string) || null }
  }
  let { json, digest } = await get(parsed.tag)
  let indexDigest: string | null = null
  if (Array.isArray(json.manifests)) {
    indexDigest = digest
    const pick = (json.manifests as { digest: string; platform?: { os?: string; architecture?: string } }[]).find(
      (m) => m.platform?.os === 'linux' && m.platform?.architecture === arch,
    )
    if (!pick) throw new Error(`远程镜像没有 linux/${arch} 版本`)
    ;({ json, digest } = await get(pick.digest))
    digest = digest || pick.digest
  }
  if (!json.config?.digest || !Array.isArray(json.layers)) throw new Error('镜像清单格式无法识别')
  return { repo: parsed.repo, tag: parsed.tag, indexDigest, manifestDigest: digest, config: json.config, layers: json.layers, base, auth }
}

/** 下载单个 blob：跟随到 CDN 的跳转（跨域不带 token），边下边校验 sha256 */
async function downloadBlob(img: RemoteImage, blob: Blob, file: string, onBytes: (n: number) => void) {
  let url = `${img.base}/v2/${img.repo}/blobs/${blob.digest}`
  let headers: Record<string, string> = { ...img.auth }
  for (let hop = 0; hop < 5; hop++) {
    const res = await streamGet('dockerhub', url, headers, 120000)
    const status = res.statusCode || 0
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume()
      const next = new URL(res.headers.location, url)
      if (next.host !== new URL(url).host) headers = {}
      url = next.toString()
      continue
    }
    if (status !== 200) {
      const text = await readBody(res)
      throw new Error(`下载镜像层失败（HTTP ${status}）：${text.slice(0, 120)}`)
    }
    const hash = createHash('sha256')
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk)
        onBytes(chunk.length)
        cb(null, chunk)
      },
    })
    await pipeline(res, meter, createWriteStream(file))
    const actual = 'sha256:' + hash.digest('hex')
    if (actual !== blob.digest) throw new Error(`镜像层校验失败：${blob.digest.slice(0, 19)}`)
    return
  }
  throw new Error('镜像层下载跳转次数过多')
}

export type Downloaded = { dir: string; configFile: string; layerFiles: string[]; repoTag: string }
export async function downloadImage(img: RemoteImage, ref: string, workDir: string, onProgress: (p: { current: number; total: number; layers: number; done: number }) => void): Promise<Downloaded> {
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  const total = img.config.size + img.layers.reduce((n, l) => n + l.size, 0)
  let current = 0, done = 0
  const tick = (n: number) => {
    current += n
    onProgress({ current, total, layers: img.layers.length, done })
  }
  const configFile = join(workDir, 'config.json')
  await downloadBlob(img, img.config, configFile, tick)
  const layerFiles: string[] = []
  for (const [i, layer] of img.layers.entries()) {
    const file = join(workDir, `layer${i}.tar`)
    await downloadBlob(img, layer, file, tick)
    layerFiles.push(file)
    done++
    onProgress({ current, total, layers: img.layers.length, done })
  }
  const short = ref.replace(/^docker\.io\//, '')
  return { dir: workDir, configFile, layerFiles, repoTag: short.includes(':') ? short : `${short}:latest` }
}

/* ---------------- docker-archive（docker load 格式）流式打包 ---------------- */

function tarHeader(name: string, size: number, type: '0' | '5' = '0') {
  const b = Buffer.alloc(512)
  b.write(name, 0, 100, 'utf8')
  b.write(type === '5' ? '0000755\0' : '0000644\0', 100)
  b.write('0000000\0', 108)
  b.write('0000000\0', 116)
  b.write(size.toString(8).padStart(11, '0') + '\0', 124)
  b.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136)
  b.fill(' ', 148, 156)
  b.write(type, 156)
  b.write('ustar\0', 257)
  b.write('00', 263)
  let sum = 0
  for (const x of b) sum += x
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return b
}
const pad = (size: number) => Buffer.alloc((512 - (size % 512)) % 512)

/** 生成 docker load 可读取的 tar 流：manifest.json + 配置 + 各层（层保持 gzip，docker load 会自动解压） */
export async function* dockerArchive(d: Downloaded): AsyncGenerator<Buffer> {
  const configName = 'config.json'
  const layerNames = d.layerFiles.map((_, i) => `layer${i}/layer.tar`)
  const manifest = Buffer.from(JSON.stringify([{ Config: configName, RepoTags: [d.repoTag], Layers: layerNames }]))
  yield tarHeader('manifest.json', manifest.length)
  yield manifest
  yield pad(manifest.length)
  const files: [string, string][] = [[configName, d.configFile], ...d.layerFiles.map((f, i): [string, string] => [layerNames[i], f])]
  for (const [i, [name, file]] of files.entries()) {
    if (i > 0) yield tarHeader(`layer${i - 1}/`, 0, '5')
    const size = statSync(file).size
    yield tarHeader(name, size)
    for await (const chunk of createReadStream(file)) yield chunk as Buffer
    yield pad(size)
  }
  yield Buffer.alloc(1024)
}
