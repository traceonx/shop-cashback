// 淘宝商品 ID 场景测试：对比 item.info.upgrade.get 不传 / 传 biz_scene_id 时的返回
// 用法：TB_KEY=你的AppKey TB_SECRET=你的AppSecret node tb-probe.mjs "淘宝分享链接或数字商品ID"
import { createHash } from 'node:crypto'
const key = process.env.TB_KEY, secret = process.env.TB_SECRET, input = process.argv[2]
if (!key || !secret || !input) { console.log('用法：TB_KEY=xxx TB_SECRET=xxx node tb-probe.mjs "链接或商品ID"'); process.exit(1) }

const safeDecode = (t) => { try { return decodeURIComponent(t) } catch { return t } }
// 在文本（含多层 URL 编码）中找数字商品 ID
function idIn(text) {
  let t = text
  for (let i = 0; i < 3; i++) {
    const hit = /(?:[?&]|\b)(?:id|itemId|item_id)=(\d{6,})/.exec(t)?.[1] || /\/i(\d{6,})\.htm/.exec(t)?.[1] || /"(?:itemId|item_id|itemid)"\s*:\s*"?(\d{6,})/.exec(t)?.[1]
    if (hit) return hit
    const next = safeDecode(t)
    if (next === t) break
    t = next
  }
  return null
}
async function itemId(text) {
  if (/^\d{6,}$/.test(text)) return text
  let url = text.match(/https?:\/\/\S+/)?.[0]
  for (let i = 0; i < 4 && url; i++) {
    const hit = idIn(url)
    if (hit) return hit
    const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } })
    const loc = r.headers.get('location')
    if (loc) { url = new URL(loc, url).toString(); continue }
    const html = await r.text()
    const found = idIn(html)
    if (!found) console.log('短链页面里没找到商品 ID，页面开头：', html.slice(0, 300).replace(/\s+/g, ' '))
    return found
  }
  return null
}
const time = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date())
async function top(method, biz) {
  const p = { method, app_key: key, timestamp: time(), format: 'json', v: '2.0', sign_method: 'md5', ...biz }
  p.sign = createHash('md5').update(secret + Object.keys(p).sort().map((k) => k + p[k]).join('') + secret, 'utf8').digest('hex').toUpperCase()
  const r = await fetch('https://eco.taobao.com/router/rest', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: new URLSearchParams(p) })
  return r.json()
}
const brief = (j) => {
  if (j.error_response) return '错误：' + JSON.stringify(j.error_response)
  const item = j.tbk_item_info_upgrade_get_response?.results?.tbk_item_detail?.[0]
  if (!item) return '无商品：' + JSON.stringify(j).slice(0, 300)
  return JSON.stringify({ item_id: item.item_id, title: item.item_basic_info?.title, shop: item.item_basic_info?.shop_title, price: item.price_promotion_info?.zk_final_price, final: item.price_promotion_info?.final_promotion_price, commission: item.publish_info?.income_info?.commission_amount })
}
const id = await itemId(input)
console.log('数字商品 ID：', id)
if (!id) process.exit(1)
for (const scene of [undefined, '1', '2', '3']) {
  const res = await top('taobao.tbk.item.info.upgrade.get', scene ? { item_id: id, biz_scene_id: scene } : { item_id: id })
  console.log(`\n[biz_scene_id=${scene ?? '不传'}]`, brief(res))
}


// ── 第三轮：淘口令生成原始返回（TB_TPWD_URL=推广链接） ──
if (process.env.TB_TPWD_URL) {
  const r = await top('taobao.tbk.tpwd.create', { url: process.env.TB_TPWD_URL, text: '复制打开手机淘宝领券购买' })
  console.log('\n[tpwd.create 原始返回]', JSON.stringify(r, null, 2))
}

// ── 第二轮：物料搜索 / 淘口令解析，看能否用数字 ID、链接、淘口令直接定位商品 ──
const adzone = process.env.TB_ADZONE
if (!adzone) { console.log('\n未设置 TB_ADZONE（PID 最后一段数字），跳过物料搜索测试'); process.exit(0) }
const share = process.argv[3] || ''
const title = /「([^「」]{4,120})」/.exec(share)?.[1]
const rows = (j) => {
  const r = j.tbk_dg_material_optional_upgrade_response?.result_list?.map_data
  return Array.isArray(r) ? r : r ? [r] : []
}
const show = (r) => `${r.item_id} | ${r.item_basic_info?.title} | ${r.item_basic_info?.shop_title}`
const link = input.match(/https?:\/\/\S+/)?.[0]
const queries = [['数字ID', id], ['短链', link], ['完整分享文案', share || undefined], ['分享标题', title]]
for (const [label, q] of queries) {
  if (!q) continue
  const res = await top('taobao.tbk.dg.material.optional.upgrade', { adzone_id: adzone, q, page_no: '1', page_size: '20' })
  if (res.error_response) { console.log(`\n[物料搜索 q=${label}] 错误：`, JSON.stringify(res.error_response)); continue }
  const list = rows(res)
  console.log(`\n[物料搜索 q=${label}] 共 ${list.length} 条`)
  for (const r of list.slice(0, 8)) console.log('  ' + show(r))
  const hit = list.find((r) => String(r.item_id).endsWith(id) || String(r.item_id).includes(id))
  if (hit) console.log('  ★ 命中数字 ID：' + show(hit))
}
if (share) {
  const res = await top('taobao.tbk.tpwd.convert', { password_content: share, adzone_id: adzone })
  console.log('\n[淘口令解析 tpwd.convert]', JSON.stringify(res).slice(0, 500))
}
