import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { platform, listPlatforms } from './platforms/registry'
import { taobaoFields } from './platforms/taobao/config'
export { decimalCents, jdDate, parseJdJson, jdSign, orderRows } from './platforms/jd'
import { db, audit, dateText } from './database'
import { decrypt, encrypt } from './security'
export const fields = {
  ...Object.fromEntries(listPlatforms().map((p) => [p.id, p.fields])),
  wecom: [
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
const configFields = (kind: string) => kind === 'wecom' ? fields.wecom : kind === 'taobao' ? taobaoFields : platform(kind).fields
export async function readConfig(kind: Provider): Promise<Config> {
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
      kind === 'taobao' ? !!(cfg.appKey && cfg.appSecret && cfg.pid) : kind !== 'wecom'
        ? platform(kind).configured(cfg)
        : !!(cfg.corpId && cfg.agentId && cfg.secret && cfg.token && cfg.aesKey),
    test: test?.value || null,
    callbackPath: '/api/v1/callbacks/wecom',
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
    if (typeof value !== 'string' || value.length > 2000) throw new BadRequestException(`${key} 格式无效`)
    if (secret && !value.trim()) continue
    next[key] = value.trim()
  }
  if (kind === 'wecom' && next.aesKey && !/^[A-Za-z0-9+/]{43}$/.test(next.aesKey))
    throw new BadRequestException('EncodingAESKey 必须为 43 位 Base64 字符')
  if (kind === 'wecom' && next.proxy && !/^https?:\/\/[^\s/]+/i.test(next.proxy))
    throw new BadRequestException('代理地址需以 http:// 或 https:// 开头')
  if (kind === 'wecom' && next.agentId && !/^\d+$/.test(next.agentId))
    throw new BadRequestException('AgentID 必须为数字')
  if (kind === 'jd' && next.positionId && !/^\d+$/.test(next.positionId))
    throw new BadRequestException('推广位 ID 必须为数字')
  if (kind === 'taobao') {
    if (next.pid && !/^mm_\d+_\d+_\d+$/.test(next.pid)) throw new BadRequestException('PID 格式应为 mm_账号_媒体_推广位')
    next.adzoneId = next.pid ? next.pid.split('_')[3] : ''
  }
  await db.$transaction(async (tx) => {
    if (kind !== 'wecom') {
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
    throw new BadRequestException(`企业微信凭证验证失败，错误码 ${Number(data.errcode) || 'UNKNOWN'}`)
  return String(data.access_token)
}
export async function testConnection(kind: Provider, actor: string, trace: string) {
  let status = 'CONNECTED',
    message = ''
  try {
    if (kind !== 'wecom') {
      message = await platform(kind).test(await readConfig(kind))
    } else {
      await wecomToken(await readConfig('wecom'))
      message = '企业微信 access_token 获取成功；回调和收信范围需单独验证'
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
