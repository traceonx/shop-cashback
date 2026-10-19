import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { platform, listPlatforms } from './platforms/registry'
export { decimalCents, jdDate, parseJdJson, jdSign, orderRows } from './platforms/jd'
import { db, audit, dateText } from './database'
import { decrypt, encrypt } from './security'
import { ECAPI_KIND, ecapiConfigured, ecapiFields, ecapiTest } from './platforms/jd/ecapi'
import { TB_ECAPI_KIND, tbEcapiConfigured, tbEcapiFields, tbEcapiTest } from './platforms/taobao/ecapi'
import { normalizePublicUrl } from './platforms/taobao/oauth'
import { orderSourceOf } from './platforms/taobao/orders'
import { parsePositionPool } from './platforms/jd/positions'
import { TAOBAO_ACCOUNT, isAdzoneCode, parseAdzonePool } from './platforms/taobao/adzones'

/** 第三方接入（喵有券）：不属于联盟平台账号，独立配置并用开关启用 */
const thirdParty: Record<string, { fields: readonly (readonly [string, string, boolean])[]; configured: (c: Config) => boolean; test: (c: Config) => Promise<string> }> = {
  [ECAPI_KIND]: { fields: ecapiFields, configured: ecapiConfigured, test: ecapiTest },
  [TB_ECAPI_KIND]: { fields: tbEcapiFields, configured: tbEcapiConfigured, test: tbEcapiTest },
}
export const isThirdParty = (kind: string) => Object.hasOwn(thirdParty, kind)
export const fields = {
  ...Object.fromEntries(listPlatforms().map((p) => [p.id, p.fields])),
  [ECAPI_KIND]: ecapiFields,
  [TB_ECAPI_KIND]: tbEcapiFields,
  wecom: [
    ['name', '名称', false],
    ['enabled', '启用', false],
    ['corpId', 'CorpID', false],
    ['agentId', 'AgentID', false],
    ['secret', '应用 Secret', true],
    ['token', '回调 Token', true],
    ['aesKey', 'EncodingAESKey', true],
    ['adminUserId', '管理员通知 UserID', false],
    ['proxy', '代理地址（可选，2022-06-20 后创建的应用需固定可信 IP 时填写，如 http://IP:端口）', false],
  ],
} as const
export type Provider = string
export type Config = Record<string, string>
const configFields = (kind: string) =>
  kind === 'wecom' ? fields.wecom : isThirdParty(kind) ? thirdParty[kind].fields : platform(kind).fields
/** 第三方接入不属于联盟平台账号，配置加密保存在系统配置中 */
const thirdPartyKey = (kind: string) => `integration:${kind}`
export async function readConfig(kind: Provider): Promise<Config> {
  if (isThirdParty(kind)) {
    const c = await db.systemConfig.findUnique({ where: { key: thirdPartyKey(kind) } })
    const value = c?.value as { encrypted?: string } | null
    return value?.encrypted ? decrypt(value.encrypted, thirdPartyKey(kind)) : {}
  }
  if (kind !== 'wecom') {
    const c = await db.affiliateConfig.findUnique({ where: { accountId: `${kind}-primary` } })
    return c ? decrypt(c.encryptedConfig, `${kind}-primary`) : {}
  }
  const c = await db.channelConfig.findUnique({ where: { channelId: 'wecom-primary' } })
  return c ? decrypt(c.encryptedConfig, 'wecom-primary') : {}
}
export async function integrationStatus(kind: Provider) {
  const cfg = await readConfig(kind),
    test = await db.systemConfig.findUnique({ where: { key: `connection:${kind}` } })
  return {
    kind,
    fields: configFields(kind).map(([key, label, secret]) => ({
      key,
      label,
      secret,
      value: secret ? '' : cfg[key] || '',
      configured: !!cfg[key],
    })),
    configured:
      isThirdParty(kind)
        ? thirdParty[kind].configured(cfg)
        : kind !== 'wecom'
        ? platform(kind).configured(cfg)
        : !!(cfg.corpId && cfg.agentId && cfg.secret && cfg.token && cfg.aesKey),
    test: test?.value || null,
    callbackPath: '/api/v1/callbacks/wecom',
    // 淘宝：旧配置未保存订单数据源时，展示推断出的实际数据源
    ...(kind === 'taobao' ? { orderSource: orderSourceOf(cfg, tbEcapiConfigured(await readConfig(TB_ECAPI_KIND))) } : {}),
    trackingVerified: false,
  }
}
export async function saveConfig(kind: Provider, body: unknown, actor: string, trace: string) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('配置格式无效')
  const previous = await readConfig(kind),
    next = { ...previous }
  for (const [key, , secret] of configFields(kind)) {
    const value = (body as Config)[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.length > (key === 'adzonePool' || key === 'positionPool' ? 10000 : 2000)) throw new BadRequestException(`${key} 格式无效`)
    if (secret && !value.trim()) continue
    next[key] = value.trim()
  }
  if (kind === 'wecom' && next.aesKey && !/^[A-Za-z0-9+/]{43}$/.test(next.aesKey))
    throw new BadRequestException('EncodingAESKey 必须为 43 位 Base64 字符')
  if (kind === 'wecom' && next.enabled && !['true', 'false'].includes(next.enabled))
    throw new BadRequestException('启用状态无效')
  if (kind === 'wecom' && next.proxy && !/^https?:\/\/[^\s/]+/i.test(next.proxy))
    throw new BadRequestException('代理地址需以 http:// 或 https:// 开头')
  if (kind === 'wecom' && next.agentId && !/^\d+$/.test(next.agentId))
    throw new BadRequestException('AgentID 必须为数字')
  if (isThirdParty(kind) && next.enabled && !['true', 'false'].includes(next.enabled))
    throw new BadRequestException('启用状态无效')
  if ((kind === 'jd' || kind === ECAPI_KIND) && next.positionId && !/^\d+$/.test(next.positionId))
    throw new BadRequestException('推广位 ID 必须为数字')
  if (kind === 'jd') {
    const jdEcapi = await readConfig(ECAPI_KIND)
    next.positionPool = parsePositionPool(next.positionPool, [next.positionId, jdEcapi.positionId], true).join('\n')
    // 已绑定用户的推广位不能从池里移除，否则后台看不到绑定关系（订单仍按绑定关联）
    const kept = new Set(parsePositionPool(next.positionPool, []))
    const removed = parsePositionPool(previous.positionPool, []).filter((id) => !kept.has(id))
    if (removed.length) {
      const bound = await db.systemConfig.findMany({ where: { key: { in: removed.map((id) => `jd-position:${id}`) } }, select: { key: true } })
      if (bound.length) throw new BadRequestException(`推广位 ${bound.map((b) => b.key.slice(12)).join('、')} 已绑定用户，不能从推广位池移除`)
    }
  }
  if (kind === 'taobao') {
    if (next.orderSource && !['official-sc', 'official', 'ecapi'].includes(next.orderSource)) throw new BadRequestException('订单数据源无效')
    if (next.autoMatch && !['true', 'false'].includes(next.autoMatch)) throw new BadRequestException('自动关联开关无效')
    if (next.perUserAdzone && !['true', 'false'].includes(next.perUserAdzone)) throw new BadRequestException('独立推广位开关无效')
    next.publicUrl = normalizePublicUrl(next.publicUrl) || ''
    if (next.pid && !/^mm_\d+_\d+_\d+$/.test(next.pid)) throw new BadRequestException('PID 格式应为 mm_账号_媒体_推广位')
    next.adzoneId = next.pid ? next.pid.split('_')[3] : ''
    if (next.adzonePool) {
      if (!next.pid) throw new BadRequestException('请先填写默认推广位 PID')
      next.adzonePool = parseAdzonePool(next.adzonePool, next, true).map((e) => e.pid).join('\n')
    }
    // 已绑定用户的推广位不能从池里移除：移除后无法再拼出该用户的 PID
    const kept = new Set(parseAdzonePool(next.adzonePool, next).map((e) => e.adzone))
    const removed = parseAdzonePool(previous.adzonePool, previous).filter((e) => !kept.has(e.adzone))
    if (removed.length) {
      const bound = await db.userTrackingCode.findMany({ where: { accountId: TAOBAO_ACCOUNT, code: { in: removed.map((e) => e.adzone) } }, select: { code: true } })
      if (bound.some((b) => isAdzoneCode(b.code))) throw new BadRequestException(`推广位 ${bound.map((b) => b.code).join('、')} 已绑定用户，不能从推广位池移除`)
    }
  }
  await db.$transaction(async (tx) => {
    if (isThirdParty(kind)) {
      const value = { encrypted: encrypt(next, thirdPartyKey(kind)) }
      await tx.systemConfig.upsert({ where: { key: thirdPartyKey(kind) }, create: { key: thirdPartyKey(kind), value }, update: { value } })
    } else if (kind !== 'wecom') {
      await tx.affiliatePlatform.upsert({ where: { code: kind }, create: { id: kind, code: kind }, update: {} })
      await tx.affiliateAccount.upsert({
        where: { id: `${kind}-primary` },
        create: { id: `${kind}-primary`, platformId: kind, externalId: next.unionId || 'primary' },
        update: { externalId: next.unionId || 'primary', trackingVerified: false },
      })
      await tx.affiliateConfig.upsert({
        where: { accountId: `${kind}-primary` },
        create: { accountId: `${kind}-primary`, encryptedConfig: encrypt(next, `${kind}-primary`), keyVersion: 1 },
        update: { encryptedConfig: encrypt(next, `${kind}-primary`) },
      })
    } else {
      await tx.channel.upsert({
        where: { id: 'wecom-primary' },
        create: { id: 'wecom-primary', kind: 'wecom', name: '企业微信自建应用', enabled: true },
        update: { enabled: true },
      })
      await tx.channelConfig.upsert({
        where: { channelId: 'wecom-primary' },
        create: { channelId: 'wecom-primary', encryptedConfig: encrypt(next, 'wecom-primary'), keyVersion: 1 },
        update: { encryptedConfig: encrypt(next, 'wecom-primary') },
      })
    }
    await tx.systemConfig.deleteMany({ where: { key: `connection:${kind}` } })
    await tx.auditLog.create({
      data: {
        actorId: actor,
        action: '保存平台配置',
        targetId: kind,
        traceId: trace,
        diff: {
          changedFields: configFields(kind)
            .filter(([k]) => previous[k] !== next[k])
            .map(([k]) => k),
        },
      },
    })
  })
  return integrationStatus(kind)
}
// 企业微信错误码说明；原始 errmsg 中常带有被拒绝的 IP（from ip: x.x.x.x），一并展示
const wecomHints: Record<number, string> = {
  40001: '应用 Secret 不正确：请确认使用的是该 AgentId 对应自建应用的 Secret（应用管理 → 应用 → Secret 查看），且未被重置',
  40013: '企业ID 不正确：请在企业微信后台「我的企业」页底部复制企业ID',
  40091: '应用 Secret 格式不正确，请重新复制完整的 Secret',
  42001: 'access_token 已过期，请重试',
  60020: '请求 IP 不在该应用的「企业可信IP」中：在应用管理 → 本应用 → 企业可信IP 里加入下方提示的 IP（使用代理时为代理服务器的公网 IP）',
  60011: '应用无权限：请检查应用可见范围，或管理员是否在可见范围内',
  81013: '接收人不在应用可见范围内，或 UserID 不存在',
}
export function wecomError(prefix: string, data: { errcode?: unknown; errmsg?: unknown }) {
  const code = Number(data.errcode) || 0
  const ip = /from ip:\s*([\d.:a-f]+)/i.exec(String(data.errmsg || ''))?.[1]
  return `${prefix}（错误码 ${code || 'UNKNOWN'}）${wecomHints[code] ? '：' + wecomHints[code] : ''}${ip ? `。被拒绝的 IP：${ip}` : ''}`
}
// 企业微信接口基址：配置了代理地址时经由代理转发（参考 MoviePilot 的 WECHAT_PROXY），否则直连官方
export const wecomUrl = (c: Config, path: string) =>
  `${(c.proxy || 'https://qyapi.weixin.qq.com').trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
export async function wecomToken(c: Config) {
  if (!c.corpId || !c.secret) throw new ServiceUnavailableException('请先在渠道管理中保存 CorpID 与应用 Secret')
  let response: Response
  try {
    response = await fetch(
      wecomUrl(c, `cgi-bin/gettoken?${new URLSearchParams({ corpid: c.corpId, corpsecret: c.secret })}`),
      { signal: AbortSignal.timeout(10000), redirect: 'error' },
    )
  } catch {
    throw new ServiceUnavailableException(c.proxy ? `企业微信代理 ${c.proxy} 连接失败或超时` : '企业微信连接失败或超时')
  }
  if (!response.ok) throw new ServiceUnavailableException('企业微信接口不可用')
  const data = (await response.json()) as any
  if (data.errcode !== 0 || !data.access_token)
    throw new BadRequestException(wecomError('企业微信凭证验证失败', data))
  return String(data.access_token)
}
export async function testConnection(kind: Provider, actor: string, trace: string) {
  let status = 'CONNECTED',
    message = ''
  try {
    if (isThirdParty(kind)) {
      message = await thirdParty[kind].test(await readConfig(kind))
    } else if (kind !== 'wecom') {
      message = await platform(kind).test(await readConfig(kind))
    } else {
      await wecomToken(await readConfig('wecom'))
      message = '企业微信 access_token 获取成功；回调和收信范围需单独验证'
      const { autoPublishMenu } = await import('./wecom-menu')
      const menu = await autoPublishMenu(actor, trace)
      if (menu) message += `。${menu}`
    }
  } catch (e) {
    status = 'FAILED'
    message = e instanceof Error ? e.message : '连接失败'
  }
  const value = { status, message, checkedAt: new Date().toISOString() }
  await db.systemConfig.upsert({
    where: { key: `connection:${kind}` },
    create: { key: `connection:${kind}`, value },
    update: { value },
  })
  await audit(actor, '平台连接测试', kind, trace, { status })
  return value
}
