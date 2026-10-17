import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { db, audit, json } from './database'
import { readConfig, wecomToken } from './integrations'

export const menuActions = {
  HELP_SHOP: { label: '如何查返利', command: '/查返利' },
  PLATFORMS: { label: '支持平台', command: '/支持平台' },
  ORDERS: { label: '全部订单', command: '/订单' },
  PENDING: { label: '待结算', command: '/待结算' },
  RECOVER: { label: '订单找回', command: '/订单找回' },
  BALANCE: { label: '余额与明细', command: '/余额' },
  WITHDRAW: { label: '申请提现', command: '/提现' },
  WITHDRAWALS: { label: '提现记录', command: '/提现记录' },
  HELP: { label: '使用帮助', command: '/帮助' },
} as const
export type MenuAction = keyof typeof menuActions
export type MenuDraft = { name: string; children: { name: string; action: MenuAction }[] }[]
export const defaultMenu: MenuDraft = [
  { name: '购物返利', children: ['HELP_SHOP', 'PLATFORMS'].map((action) => ({ name: menuActions[action as MenuAction].label, action: action as MenuAction })) },
  { name: '我的订单', children: ['ORDERS', 'PENDING', 'RECOVER'].map((action) => ({ name: menuActions[action as MenuAction].label, action: action as MenuAction })) },
  { name: '我的账户', children: ['BALANCE', 'WITHDRAW', 'WITHDRAWALS', 'HELP'].map((action) => ({ name: menuActions[action as MenuAction].label, action: action as MenuAction })) },
]
export function validateMenu(value: unknown): MenuDraft {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new BadRequestException('一级菜单需要 1–3 个')
  function name(v: unknown, max: number) {
    if (typeof v !== 'string' || !v.trim() || Buffer.byteLength(v.trim(), 'utf8') > max) throw new BadRequestException(`菜单名称不能为空，且不能超过 ${max} 字节`)
    return v.trim()
  }
  return value.map((group) => {
    if (!group || !Array.isArray(group.children) || group.children.length < 1 || group.children.length > 5) throw new BadRequestException('每个一级菜单需要 1–5 个子菜单')
    return { name: name(group.name, 16), children: group.children.map((child: any) => {
      if (!child || !Object.hasOwn(menuActions, child.action)) throw new BadRequestException('不支持的菜单动作')
      return { name: name(child.name, 40), action: child.action as MenuAction }
    }) }
  })
}
export function menuPayload(draft: MenuDraft) {
  return { button: validateMenu(draft).map((g) => ({ name: g.name, sub_button: g.children.map((c) => ({ name: c.name, type: 'click', key: `SHIHUI_${c.action}` })) })) }
}
export function menuCommand(key: string): string | null {
  if (!key.startsWith('SHIHUI_')) return null
  const action = key.slice(7)
  return Object.hasOwn(menuActions, action) ? menuActions[action as MenuAction].command : null
}
export async function getMenu() {
  const [draft, published] = await Promise.all([
    db.systemConfig.findUnique({ where: { key: 'wecom:menu:draft' } }),
    db.systemConfig.findUnique({ where: { key: 'wecom:menu:published' } }),
  ])
  return { draft: draft?.value || defaultMenu, published: published?.value || null, actions: menuActions }
}
export async function saveMenu(value: unknown, actor: string, trace: string) {
  const draft = validateMenu(value)
  await db.systemConfig.upsert({ where: { key: 'wecom:menu:draft' }, create: { key: 'wecom:menu:draft', value: json(draft) }, update: { value: json(draft) } })
  await audit(actor, '保存企业微信菜单草稿', 'wecom-primary', trace)
  return getMenu()
}
export async function publishMenu(value: unknown, actor: string, trace: string) {
  const draft = validateMenu(value), config = await readConfig('wecom')
  if (!config.agentId || !/^\d+$/.test(config.agentId)) throw new BadRequestException('请先保存企业微信 AgentID')
  if (!config.token || !config.aesKey) throw new BadRequestException('请先配置企业微信消息回调 Token 和 EncodingAESKey')
  const token = await wecomToken(config)
  let response: Response
  try {
    response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/menu/create?${new URLSearchParams({ access_token: token, agentid: config.agentId })}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menuPayload(draft)), signal: AbortSignal.timeout(10000), redirect: 'error',
    })
  } catch { throw new ServiceUnavailableException('菜单发布请求失败或超时，请检查企业微信后台实际菜单后重试') }
  const result = await response.json() as { errcode?: number }
  if (!response.ok || result.errcode !== 0) throw new BadRequestException(`企业微信菜单发布失败，错误码 ${result.errcode ?? response.status}`)
  const published = { draft, publishedAt: new Date().toISOString(), agentId: config.agentId }
  await db.systemConfig.upsert({ where: { key: 'wecom:menu:published' }, create: { key: 'wecom:menu:published', value: json(published) }, update: { value: json(published) } })
  await audit(actor, '发布企业微信应用菜单', 'wecom-primary', trace)
  return getMenu()
}
