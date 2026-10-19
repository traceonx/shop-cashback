// 出站代理（仅用于少数需要翻墙的请求）：环境变量 PROXY_HOST，如 http://192.168.5.199:7890 或 socks5://user:pass@host:7891（mihomo mixed-port 两种都可）。
// 只有 PROXIED 中列出的服务走代理（Docker Hub 版本查询、Telegram 通知等境外服务，以及按 IP 白名单校验的喵有券）；企业微信、淘宝、京东官方等国内接口始终直连。无第三方依赖。
import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'

// ecapi：喵有券按 IP 白名单校验，家用宽带出口 IP 不固定时经代理（固定出口 IP 的节点）访问
const PROXIED = ['dockerhub', 'telegram', 'ecapi'] as const
export type ProxyScope = (typeof PROXIED)[number]
export type ProxyConfig = { protocol: 'socks5' | 'http'; host: string; port: number; username?: string; password?: string }

/** 解析代理地址；返回 null 表示未配置。仅支持 socks5/socks5h/socks/http（不支持到代理的 https 加密连接） */
export function parseProxyUrl(raw: string): ProxyConfig | null {
  const text = raw.trim()
  if (!text) return null
  let u: URL
  try {
    u = new URL(text.includes('://') ? text : 'http://' + text)
  } catch {
    throw new Error('代理地址格式不正确，示例：socks5://192.168.5.6:7890')
  }
  const scheme = u.protocol.replace(':', '').toLowerCase()
  const protocol = ['socks5', 'socks5h', 'socks'].includes(scheme) ? 'socks5' : scheme === 'http' ? 'http' : null
  if (!protocol) throw new Error('仅支持 socks5:// 或 http:// 代理（mihomo 的 mixed-port 两种都可用）')
  if (!u.hostname) throw new Error('代理地址缺少主机')
  return { protocol, host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || (protocol === 'socks5' ? 1080 : 80), username: decodeURIComponent(u.username) || undefined, password: decodeURIComponent(u.password) || undefined }
}
export const maskProxyUrl = (raw: string) => raw.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@')

/** 当前生效的代理（仅 PROXIED 内的服务）；未设置或格式错误时返回 null 直连 */
export function activeProxy(scope: ProxyScope) {
  if (!PROXIED.includes(scope)) return null
  try {
    return parseProxyUrl(process.env.PROXY_HOST || '')
  } catch (e) {
    console.warn(`[网络代理] PROXY_HOST 无效，已直连：${(e as Error).message}`)
    return null
  }
}
export const proxyLabel = (c: ProxyConfig) => `${c.protocol}://${c.host}:${c.port}`

/* ---------------- 隧道 ---------------- */

function once(socket: Socket, bytes: number) {
  return new Promise<Buffer>((ok, fail) => {
    let buf = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (buf.length >= bytes) {
        cleanup()
        if (buf.length > bytes) socket.unshift(buf.subarray(bytes))
        ok(buf.subarray(0, bytes))
      }
    }
    const onErr = (e: Error) => { cleanup(); fail(e) }
    const onEnd = () => { cleanup(); fail(new Error('代理连接被关闭')) }
    // 移除监听后必须暂停，否则流仍处于流动模式，两次读取之间到达的数据会丢失
    const cleanup = () => { socket.off('data', onData); socket.off('error', onErr); socket.off('end', onEnd); socket.pause() }
    socket.on('data', onData).on('error', onErr).on('end', onEnd)
    socket.resume() // 显式暂停过的流不会因添加监听而自动恢复
  })
}
const socksErrors: Record<number, string> = { 1: '代理服务器故障', 2: '规则不允许', 3: '网络不可达', 4: '主机不可达', 5: '连接被拒绝', 6: 'TTL 过期', 7: '不支持的命令', 8: '不支持的地址类型' }

async function socks5Tunnel(c: ProxyConfig, host: string, port: number, socket: Socket) {
  const auth = !!(c.username || c.password)
  socket.write(Buffer.from(auth ? [5, 2, 0, 2] : [5, 1, 0]))
  const [ver, method] = await once(socket, 2)
  if (ver !== 5) throw new Error('代理不是 SOCKS5 协议（请确认端口与协议类型）')
  if (method === 2) {
    const u = Buffer.from(c.username || ''), p = Buffer.from(c.password || '')
    socket.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]))
    const [, status] = await once(socket, 2)
    if (status !== 0) throw new Error('SOCKS5 用户名或密码错误')
  } else if (method !== 0) throw new Error('SOCKS5 代理要求的认证方式不受支持')
  const name = Buffer.from(host)
  const req = Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 255])])
  socket.write(req)
  const head = await once(socket, 4)
  if (head[1] !== 0) throw new Error(`SOCKS5 连接目标失败：${socksErrors[head[1]] || head[1]}`)
  const rest = head[3] === 1 ? 6 : head[3] === 4 ? 18 : (await once(socket, 1))[0] + 2
  await once(socket, rest)
}
async function httpTunnel(c: ProxyConfig, host: string, port: number, socket: Socket) {
  const auth = c.username || c.password ? `Proxy-Authorization: Basic ${Buffer.from(`${c.username || ''}:${c.password || ''}`).toString('base64')}\r\n` : ''
  socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`)
  let head = ''
  while (!head.includes('\r\n\r\n')) {
    head += (await once(socket, 1)).toString('latin1')
    if (head.length > 8192) throw new Error('HTTP 代理响应异常')
  }
  const code = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1])
  if (code !== 200) throw new Error(`HTTP 代理拒绝连接（${code || '未知'}）${code === 407 ? '：需要正确的用户名和密码' : ''}`)
}
export async function openTunnel(c: ProxyConfig, host: string, port: number, timeoutMs = 10000): Promise<Socket> {
  const socket = netConnect({ host: c.host, port: c.port })
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`代理 ${proxyLabel(c)} 连接超时`)))
  await new Promise<void>((ok, fail) => {
    socket.once('connect', ok)
    socket.once('error', (e: NodeJS.ErrnoException) => fail(new Error(e.code === 'ECONNREFUSED' ? `无法连接代理 ${proxyLabel(c)}（连接被拒绝，检查地址、端口及 mihomo 的 allow-lan）` : `无法连接代理 ${proxyLabel(c)}：${e.message}`)))
  })
  if (c.protocol === 'socks5') await socks5Tunnel(c, host, port, socket)
  else await httpTunnel(c, host, port, socket)
  socket.setTimeout(0)
  socket.resume() // 交还给 HTTP/TLS 前恢复流动（握手阶段被暂停）
  return socket
}

/* ---------------- fetch 兼容封装 ---------------- */

async function proxiedFetch(c: ProxyConfig, input: string | URL, init: RequestInit = {}, hops = 0): Promise<Response> {
  const url = new URL(String(input))
  const secure = url.protocol === 'https:'
  const port = Number(url.port) || (secure ? 443 : 80)
  const raw = await openTunnel(c, url.hostname, port)
  const socket = secure ? tlsConnect({ socket: raw, servername: url.hostname }) : raw
  const headers = new Headers(init.headers)
  let body: Buffer | undefined
  if (init.body instanceof URLSearchParams) {
    body = Buffer.from(init.body.toString())
    if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')
  } else if (typeof init.body === 'string') body = Buffer.from(init.body)
  else if (init.body) throw new Error('代理请求暂不支持该请求体类型')
  if (body) headers.set('content-length', String(body.length))
  const signal = init.signal
  const res = await new Promise<IncomingMessage>((ok, fail) => {
    const req = (secure ? httpsRequest : httpRequest)(
      { host: url.hostname, port, path: url.pathname + url.search, method: init.method || 'GET', headers: Object.fromEntries(headers), createConnection: () => socket as Socket }, // 不传 agent：Node 才会使用自定义连接（agent:false 会忽略它）
      ok,
    )
    req.on('error', fail)
    signal?.addEventListener('abort', () => req.destroy(new Error('请求超时')), { once: true })
    req.end(body)
  })
  const chunks: Buffer[] = []
  for await (const chunk of res) chunks.push(chunk as Buffer)
  const status = res.statusCode || 0
  const outHeaders = new Headers()
  for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) outHeaders.set(k, Array.isArray(v) ? v.join(', ') : v)
  if (status >= 300 && status < 400 && outHeaders.get('location')) {
    if (init.redirect === 'error') throw new Error(`请求被重定向（${status}）`)
    if (init.redirect !== 'manual' && hops < 5) return proxiedFetch(c, new URL(outHeaders.get('location')!, url), { ...init, method: status === 303 ? 'GET' : init.method, body: status === 303 ? undefined : init.body }, hops + 1)
  }
  const nullBody = [101, 204, 205, 304].includes(status)
  return new Response(nullBody ? null : Buffer.concat(chunks), { status, headers: outHeaders })
}

/** 替代 fetch：设置了 PROXY_HOST 且属于需代理的服务时经代理请求，否则直连 */
export async function outboundFetch(scope: ProxyScope, input: string | URL, init?: RequestInit): Promise<Response> {
  const c = activeProxy(scope)
  return c ? proxiedFetch(c, input, init) : fetch(input, init)
}

/** 流式 GET（大文件下载）：按服务决定是否经代理；timeoutMs 为空闲超时（期间没有任何数据即中断） */
export async function streamGet(scope: ProxyScope, url: string, headers: Record<string, string> = {}, timeoutMs = 60000): Promise<IncomingMessage> {
  const u = new URL(url)
  const secure = u.protocol === 'https:'
  const port = Number(u.port) || (secure ? 443 : 80)
  const c = activeProxy(scope)
  let createConnection: (() => Socket) | undefined
  if (c) {
    const raw = await openTunnel(c, u.hostname, port)
    const sock = secure ? tlsConnect({ socket: raw, servername: u.hostname }) : raw
    createConnection = () => sock as Socket
  }
  return new Promise((ok, fail) => {
    const req = (secure ? httpsRequest : httpRequest)(
      { host: u.hostname, port, path: u.pathname + u.search, method: 'GET', headers, timeout: timeoutMs, ...(createConnection ? { createConnection } : {}) },
      ok,
    )
    req.on('timeout', () => req.destroy(new Error(`${u.hostname} 长时间无响应`)))
    req.on('error', fail)
    req.end()
  })
}
