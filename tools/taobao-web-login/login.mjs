import { chromium } from 'playwright'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const input = createInterface({ input: stdin, output: stdout })
let browser
try {
  const server = new URL((await input.question('拾惠后台地址（HTTPS，或本机 http://localhost:3001）：')).trim())
  if (server.username || server.password || server.search || server.hash ||
      (server.protocol !== 'https:' && !(server.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname))))
    throw new Error('只接受 HTTPS 地址，或本机 HTTP 地址')
  const token = (await input.question('粘贴后台生成的 10 分钟一次性配对码：')).trim()
  if (!/^[\w-]{43}$/.test(token)) throw new Error('配对码格式不正确')
  console.log('请在独立浏览器里登录正确的淘宝联盟账号。不要关闭浏览器，返回此窗口继续。')
  browser = await chromium.launchPersistentContext(fileURLToPath(new URL('./profile', import.meta.url)), {
    channel: process.env.BROWSER_CHANNEL || 'chrome', headless: false, viewport: null,
  })
  const page = browser.pages()[0] || await browser.newPage()
  await page.goto('https://pub.alimama.com/portal/v2/effect/order/overviewOrder/page/index.htm')
  await input.question('确认已经看到淘宝联盟订单页面，且账号与后台 PID 对应后，按回车完成连接：')
  const cookies = await browser.cookies('https://pub.alimama.com/openapi/param2/1/gateway.unionpub/report.getTbkOrderDetails.json')
  const response = await fetch(new URL('/api/v1/callbacks/taobao/web-session', server), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cookies }), redirect: 'error', signal: AbortSignal.timeout(65000),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message || '服务器验证失败，请在后台查看状态')
  console.log(`连接完成，状态：${body.data?.state}。可以关闭此窗口；失效后重新获取配对码并运行助手。`)
} catch (e) {
  // Playwright / fetch 错误可能包含 URL 等信息，不输出对象、请求头或 Cookie。
  console.error('连接未完成：请检查后台地址、配对码有效期及浏览器登录状态。')
  process.exitCode = 1
} finally {
  input.close()
  await browser?.close()
}
