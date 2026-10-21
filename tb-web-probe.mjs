// 淘宝联盟网页接口测试：用浏览器「复制为 cURL」的登录信息，模拟服务端（不经浏览器）查询订单
// 用法：把 cURL（cmd 或 bash 格式均可）保存到文本文件，执行 node tb-web-probe.mjs 文件路径 [日期 yyyy-mm-dd]
// 只读请求；不保存、不输出 Cookie。测完请删除该文本文件。
import { readFileSync } from 'node:fs'
const [file, date] = process.argv.slice(2)
if (!file) { console.log('用法：node tb-web-probe.mjs curl.txt [2026-10-20]'); process.exit(1) }
// 还原 cmd 的 ^ 转义（^" ^% ^& ^\^" 等），再按 bash 规则取参数
let raw = readFileSync(file, 'utf8')
if (/\^"/.test(raw)) raw = raw.replace(/\^\s*\r?\n/g, ' ').replace(/\^\\\^"/g, '\\"').replace(/\^(.)/g, '$1')
raw = raw.replace(/\\\r?\n/g, ' ')
const args = [...raw.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g)].map(m => m[1] != null ? m[1].replace(/\\"/g, '"') : m[2] ?? m[3])
let cookie = '', ua = ''
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '-b' || a === '--cookie') cookie = args[++i]
  else if (a === '-H' || a === '--header') {
    const h = args[++i], k = h.slice(0, h.indexOf(':')).trim().toLowerCase(), v = h.slice(h.indexOf(':') + 1).trim()
    if (k === 'cookie') cookie = v
    if (k === 'user-agent') ua = v
  }
}
const token = /(?:^|;\s*)_tb_token_=([^;]+)/.exec(cookie)?.[1]
if (!cookie || !token) { console.log('没有在 cURL 中找到 Cookie 或 _tb_token_，请确认复制的是 pub.alimama.com 的请求'); process.exit(1) }
console.log(`已读取 Cookie ${cookie.split(';').length} 项，UA：${ua ? '有' : '无（使用默认）'}`)
const d = date || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const q = new URLSearchParams({ t: String(Date.now()), _tb_token_: token, pageNo: '1', pageSize: '20', startTime: d, endTime: d,
  payStatus: '', queryType: '2', jumpType: '0', tkTradeId: '', positionIndex: '' })
try {
  const r = await fetch(`https://pub.alimama.com/openapi/param2/1/gateway.unionpub/report.getTbkOrderDetails.json?${q}`, {
    headers: { Cookie: cookie, Accept: 'application/json', 'bx-v': '2.5.11', 'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://pub.alimama.com/portal/v2/effect/order/overviewOrder/page/index.htm',
      'User-Agent': ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' },
    redirect: 'manual', signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  console.log(`HTTP ${r.status}${r.headers.get('location') ? ' 跳转到 ' + r.headers.get('location').split('?')[0] : ''}`)
  let j; try { j = JSON.parse(text) } catch { console.log('返回不是 JSON（可能是登录页或滑块验证页）：', text.replace(/\s+/g, ' ').slice(0, 150)); process.exit(2) }
  console.log(`success=${j.success} resultCode=${j.resultCode} bizErrorCode=${j.bizErrorCode}${j.message ? ' message=' + j.message : ''}`)
  const rows = j.data?.result
  if (!Array.isArray(rows)) { console.log('没有订单列表字段：', JSON.stringify(j).slice(0, 200)); process.exit(2) }
  console.log(`${d} 订单 ${rows.length} 条，还有下一页：${j.data.hasNext}`)
  for (const o of rows) console.log(`- ${o.tradeId} ${o.tkStatusText} 推广位 ${o.adzoneId} 预估佣金 ¥${o.pubSharePreFee} 联盟账号 ${o.pubId} ${String(o.itemTitle).slice(0, 20)}`)
  console.log('结论：服务端直接带 Cookie 调用可用 ✅')
} catch (e) { console.log('请求失败：', e.cause?.code || e.message) }
