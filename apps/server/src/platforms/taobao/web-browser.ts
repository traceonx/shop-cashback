import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { readConfig } from '../../integrations'
import { connectWebLogin } from './web'
import { WebError } from './web-core'

const HOME = 'https://pub.alimama.com/portal/v2/effect/order/overviewOrder/page/index.htm'
const WIDTH = 1280, HEIGHT = 800
type Login = {
  id: string; state: 'OPENING' | 'WAITING' | 'VERIFYING' | 'CONNECTED' | 'ERROR' | 'CANCELLED';
  message: string; expiresAt: number; context?: BrowserContext; page?: Page;
  timer?: NodeJS.Timeout; expires?: NodeJS.Timeout; checking?: boolean;
  paused?: boolean; nextCheckAt?: number;
}
let current: Login | undefined
const active = (login: Login) => current === login && !['CANCELLED', 'ERROR', 'CONNECTED'].includes(login.state)
async function close(login: Login) {
  clearInterval(login.timer); clearTimeout(login.expires)
  await login.context?.close().catch(() => undefined)
  login.context = undefined; login.page = undefined
}
export function browserLoginStatus() {
  if (!current) return { state: 'IDLE', message: '', expiresAt: null, width: WIDTH, height: HEIGHT }
  return { state: current.state, message: current.message, paused: !!current.paused, expiresAt: current.expiresAt, width: WIDTH, height: HEIGHT }
}
export async function cancelBrowserLogin() {
  if (current) { current.state = 'CANCELLED'; current.message = '登录已取消'; await close(current) }
  return browserLoginStatus()
}
export async function startBrowserLogin() {
  const c = await readConfig('taobao')
  if (!/^mm_\d+_\d+_\d+$/.test(c.pid || '')) throw new BadRequestException('请先保存淘宝推广位 PID')
  if (current && active(current)) return browserLoginStatus()
  if (current) await close(current)
  const login: Login = { id: randomUUID(), state: 'OPENING', message: '正在打开淘宝联盟官方登录页面…', expiresAt: Date.now() + 10 * 60000 }
  current = login
  // 立即返回；浏览器启动错误由状态接口提供，避免代理请求超时。
  void launch(login)
  return browserLoginStatus()
}
async function launch(login: Login) {
  try {
    const linux = process.platform === 'linux'
    const executablePath = process.env.TAOBAO_BROWSER_EXECUTABLE ||
      (linux ? ['/usr/bin/chromium-browser', '/usr/bin/chromium'].find(existsSync) : undefined)
    const options = {
      headless: linux && !process.env.DISPLAY,
      viewport: { width: WIDTH, height: HEIGHT },
      ...(executablePath ? { executablePath } : { channel: process.env.TAOBAO_BROWSER_CHANNEL || 'chrome' }),
      ...(linux ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}),
    }
    const profile = resolve(process.env.DATA_DIR || 'data', 'taobao-web-browser')
    let context: BrowserContext
    try { context = await chromium.launchPersistentContext(profile, options) }
    catch (e) {
      if (process.platform !== 'win32' || executablePath || process.env.TAOBAO_BROWSER_CHANNEL) throw e
      context = await chromium.launchPersistentContext(profile, { ...options, channel: 'msedge' })
    }
    if (!active(login)) { await context.close(); return }
    login.context = context
    context.on('page', page => { if (active(login)) login.page = page })
    // 一次登录只处理淘宝/阿里妈妈相关页面，不提供任意 URL 浏览器代理。
    await context.route('**/*', route => {
      const req = route.request()
      if (req.isNavigationRequest() && req.frame().parentFrame() === null) {
        const u = new URL(req.url())
        if (!/(^|\.)(taobao\.com|tmall\.com|alimama\.com|alipay\.com)$/.test(u.hostname)) return route.abort()
      }
      return route.continue()
    })
    context.on('close', () => {
      if (active(login)) { login.state = 'CANCELLED'; login.message = '登录窗口已关闭'; void close(login) }
    })
    login.page = context.pages()[0] || await context.newPage()
    await login.page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 30000 })
    if (!active(login)) return
    login.state = 'WAITING'; login.message = '请在官方页面选择扫码登录，用手机淘宝扫码并确认。登录成功后将自动连接。'
    login.timer = setInterval(() => void check(login), 15000)
    login.timer.unref()
    login.expires = setTimeout(() => {
      if (active(login)) { login.state = 'ERROR'; login.message = '登录页面已超时，请重新打开登录'; void close(login) }
    }, Math.max(1, login.expiresAt - Date.now()))
    login.expires.unref()
    await check(login)
  } catch {
    if (!active(login)) return
    login.state = 'ERROR'
    login.message = '无法打开登录页面。电脑端请安装 Chrome 或 Edge；Docker 请使用包含 Chromium 的新版镜像，并确认能访问淘宝。'
    await close(login)
  }
}
async function check(login: Login, manual = false) {
  if (!active(login) || !login.context || !login.page || login.checking) return
  if (!manual && (login.paused || Date.now() < (login.nextCheckAt || 0))) return
  // 未回到联盟网站前，不拿未登录 Cookie 请求订单。
  if (new URL(login.page.url()).hostname !== 'pub.alimama.com') return
  login.checking = true
  try {
    const cookies = await login.context.cookies('https://pub.alimama.com/openapi/param2/1/gateway.unionpub/report.getTbkOrderDetails.json')
    if (!cookies.some(c => c.name === '_tb_token_')) return
    // 匿名页面也会生成 CSRF token，不能以此作为登录成功的依据。
    if (!manual && !cookies.some(c => c.name === 'login' && c.value === 'true')) return
    const userAgent = await login.page.evaluate(() => navigator.userAgent)
    login.state = 'VERIFYING'; login.message = '正在验证淘宝联盟会话…'
    await connectWebLogin(cookies, userAgent, () => active(login))
    if (!active(login)) return
    login.state = 'CONNECTED'; login.message = '淘宝联盟登录成功，已连接。'
    await close(login)
  } catch (e) {
    if (!active(login)) return
    login.state = 'WAITING'
    login.paused = true
    login.nextCheckAt = Date.now() + 60000
    login.message = (e instanceof WebError ? e.message : '会话验证未完成') + '。已暂停自动请求，请在官方页面完成登录或人工验证，再点击“已完成登录，验证连接”。'
  } finally { login.checking = false }
}
export async function verifyBrowserLogin() {
  const login = current
  if (!login || !active(login)) throw new BadRequestException('请先打开登录页面')
  if (Date.now() < (login.nextCheckAt || 0)) throw new BadRequestException('请稍候一分钟再验证，避免重复请求')
  if (!login.page || new URL(login.page.url()).hostname !== 'pub.alimama.com')
    throw new BadRequestException('请先在官方页面完成登录并返回淘宝联盟')
  login.nextCheckAt = Date.now() + 60000
  await check(login, true)
  return browserLoginStatus()
}
export async function browserLoginScreenshot() {
  if (!current || !active(current) || !current.page) return null
  try { return (await current.page.screenshot({ type: 'jpeg', quality: 75, timeout: 5000 })).toString('base64') }
  catch { return null }
}
export async function browserLoginClick(x: unknown, y: unknown) {
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) ||
    x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) throw new BadRequestException('点击位置无效')
  if (!current || !active(current) || !current.page) throw new BadRequestException('请先打开登录页面')
  await current.page.mouse.click(x, y)
}

/** 只转发管理员在登录画面上的实际拖动，不识别或自动求解验证码。 */
export async function browserLoginDrag(points: unknown) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 100 || points.some(p =>
    !p || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
    p.x < 0 || p.y < 0 || p.x >= WIDTH || p.y >= HEIGHT)) throw new BadRequestException('拖动位置无效')
  const page = current?.page
  if (!current || !active(current) || !page) throw new BadRequestException('请先打开登录页面')
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  try { for (const p of points.slice(1)) await page.mouse.move(p.x, p.y) }
  finally { await page.mouse.up() }
}
