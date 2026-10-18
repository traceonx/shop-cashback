import 'reflect-metadata'
import { AppLogger, readLogs, logText } from './logs'
import './config'
import { NestFactory } from '@nestjs/core'
import {
  Module,
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  Catch,
  ArgumentsHost,
  HttpException,
  ExceptionFilter,
  ServiceUnavailableException,
} from '@nestjs/common'
import { SwaggerModule, DocumentBuilder, ApiBearerAuth } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { text, static as serveStatic } from 'express'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import helmet from 'helmet'
import { db, audit, centsNumber, dateText } from './database'
import { getMenu, saveMenu, publishMenu } from './wecom-menu'
import { env, requireEnv } from './config'
import { hashPassword, verifyPassword } from './security'
import * as business from './business'
import { startOrderSync, orderSyncStatus, processOrderSync } from './order-sync'
import { startAutoSync } from './auto-sync'
import { platform, listPlatforms } from './platforms/registry'
import { integrationStatus, saveConfig, testConnection, readConfig, type Provider } from './integrations'
import { decryptCallback, receiveCallback, processInbox } from './wecom'
import { version as appVersion, versionText } from './version'
import { updateStatus, startUpdate } from './update'
const secret = requireEnv('JWT_SECRET')
if (secret.length < 32) throw new Error('JWT_SECRET 至少 32 字符')
type AuthRequest = Request & { actor?: { id: string; role: string; name: string }; traceId?: string }
const failedLogins = new Map<string, { count: number; until: number }>()
@Injectable()
class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>()
    let id: string
    let version: number
    try {
      const token = jwt.verify(req.headers.authorization?.replace(/^Bearer /, '') || '', secret, {
        algorithms: ['HS256'],
        issuer: 'shihui',
        audience: 'admin',
      }) as jwt.JwtPayload
      id = String(token.sub || '')
      version = token.passwordVersion
    } catch {
      throw new UnauthorizedException('登录已失效，请重新登录')
    }
    const admin = await db.adminUser.findUnique({ where: { id }, include: { role: true } })
    if (
      !admin?.enabled ||
      admin.passwordVersion !== version ||
      admin.role.name !== 'SUPER_ADMIN'
    )
      throw new UnauthorizedException('账户已禁用或无后台权限')
    req.actor = { id: admin.id, role: admin.role.name, name: admin.username }
    return true
  }
}
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const c = host.switchToHttp(),
      req = c.getRequest<AuthRequest>(),
      res = c.getResponse<Response>()
    const status = error instanceof HttpException ? error.getStatus() : 500
    if (status >= 500) console.error(`[接口] ${req.method} ${req.originalUrl} 失败：`, error instanceof Error ? error.stack || error.message : error)
    res.status(status).json({
      data: null,
      message: status === 500 ? '服务异常，请检查数据库连接或联系管理员' : (error as Error).message,
      traceId: req.traceId,
    })
  }
}
function validatePassword(password: unknown) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 128 || !password.trim())
    throw new BadRequestException('密码不能为空或超过 128 位')
}
const dummyHash = hashPassword(randomUUID())
@Controller('api/v1')
class PublicController {
  @Get('health') async health() {
    try {
      await db.$queryRaw`SELECT 1`
      return { data: { status: 'ok', mode: 'live', persistence: 'postgresql', ...appVersion } }
    } catch {
      throw new ServiceUnavailableException('数据库连接不可用')
    }
  }
  @Get('auth/setup-status') async setupStatus() {
    return {
      data: {
        initialized:
          !!(await db.systemConfig.findUnique({ where: { key: 'admin-initialized' } })) ||
          (await db.adminUser.count()) > 0,
      },
    }
  }
  @Post('auth/setup') async setup(@Body() body: { username?: unknown; password?: unknown }, @Req() req: AuthRequest) {
    if (typeof body?.username !== 'string' || !/^[\p{L}\p{N}_.@-]{3,64}$/u.test(body.username.trim()))
      throw new BadRequestException('用户名为 3–64 位文字、数字、下划线、点或短横线')
    validatePassword(body.password)
    const username = body.username.trim().toLowerCase(),
      passwordHash = hashPassword(body.password as string)
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73194712)`
      if ((await tx.systemConfig.findUnique({ where: { key: 'admin-initialized' } })) || (await tx.adminUser.count()))
        throw new ForbiddenException('管理员已创建，请登录')
      const role = await tx.role.upsert({ where: { name: 'SUPER_ADMIN' }, create: { name: 'SUPER_ADMIN' }, update: {} })
      const admin = await tx.adminUser.create({ data: { username, passwordHash, roleId: role.id } })
      await tx.systemConfig.create({ data: { key: 'admin-initialized', value: true } })
      await tx.auditLog.create({
        data: { actorId: admin.id, action: '创建初始管理员', targetId: admin.id, traceId: req.traceId!, diff: {} },
      })
    })
    return { data: { created: true } }
  }
  @Post('auth/login') async login(@Body() body: { username?: unknown; password?: unknown }, @Req() req: AuthRequest) {
    const key = req.ip || 'local',
      now = Date.now()
    const limit = failedLogins.get(key)
    if (limit && limit.until > now && limit.count >= 8) throw new HttpException('登录尝试过多，请 15 分钟后重试', 429)
    if (
      typeof body?.username !== 'string' ||
      typeof body?.password !== 'string' ||
      body.username.length > 254 ||
      body.password.length > 256
    )
      throw new BadRequestException('请输入用户名与密码')
    const admin = await db.adminUser.findUnique({
      where: { username: body.username.trim().toLowerCase() },
      include: { role: true },
    })
    const valid = verifyPassword(body.password, admin?.passwordHash || dummyHash)
    if (!admin?.enabled || admin.role.name !== 'SUPER_ADMIN' || !valid) {
      failedLogins.set(key, {
        count: limit && limit.until > now ? limit.count + 1 : 1,
        until: limit && limit.until > now ? limit.until : now + 900000,
      })
      throw new UnauthorizedException('账号或密码错误')
    }
    failedLogins.delete(key)
    await audit(admin.id, '管理员登录', admin.id, req.traceId!)
    return {
      data: {
        token: jwt.sign({ role: admin.role.name, passwordVersion: admin.passwordVersion }, secret, {
          subject: admin.id,
          expiresIn: '8h',
          issuer: 'shihui',
          audience: 'admin',
        }),
        role: admin.role.name,
        name: admin.username,
      },
    }
  }
  @Get('callbacks/wecom') async verify(@Req() req: AuthRequest, @Res() res: Response) {
    const q = rawQuery(req.originalUrl)
    try {
      const output = decryptCallback(await readConfig('wecom'), q.msg_signature || '', q.timestamp || '', q.nonce || '', q.echostr || '')
      console.log('[企业微信] 回调 URL 验证成功')
      res.type('text/plain').send(output)
    } catch (e) {
      const message = e instanceof Error ? e.message : '验证失败'
      console.warn(`[企业微信] 回调 URL 验证失败：${message}（参数：${['msg_signature', 'timestamp', 'nonce', 'echostr'].filter((k) => q[k]).join(',') || '无'}）`)
      res.status(e instanceof HttpException ? e.getStatus() : 500).type('text/plain').send(message)
    }
  }
  @Post('callbacks/wecom') async callback(@Req() req: AuthRequest, @Body() body: unknown, @Res() res: Response) {
    try {
      if (typeof body !== 'string') throw new BadRequestException('需要 XML 消息体')
      await receiveCallback(rawQuery(req.originalUrl), body)
      res.type('text/plain').send('success')
    } catch (e) {
      const message = e instanceof Error ? e.message : '处理失败'
      console.warn(`[企业微信] 回调消息处理失败：${message}`)
      res.status(e instanceof HttpException ? e.getStatus() : 500).type('text/plain').send(message)
    }
  }
}
// 企业微信签名基于原始参数值；不使用会把 “+” 解码成空格的通用查询解析
function rawQuery(url: string) {
  const out: Record<string, string> = {}
  for (const part of (url.split('?')[1] || '').split('&')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    try {
      out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1))
    } catch {}
  }
  return out
}
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/v1')
class AdminController {
  @Post('auth/change-password') async changePassword(
    @Body() body: { currentPassword?: unknown; newPassword?: unknown },
    @Req() req: AuthRequest,
  ) {
    validatePassword(body?.newPassword)
    if (typeof body?.currentPassword !== 'string' || body.currentPassword.length > 256)
      throw new BadRequestException('请输入当前密码')
    const key = 'password:' + req.actor!.id,
      now = Date.now(),
      limit = failedLogins.get(key)
    if (limit && limit.until > now && limit.count >= 8) throw new HttpException('尝试过多，请 15 分钟后重试', 429)
    const admin = await db.adminUser.findUniqueOrThrow({ where: { id: req.actor!.id } })
    if (!verifyPassword(body.currentPassword, admin.passwordHash)) {
      failedLogins.set(key, {
        count: limit && limit.until > now ? limit.count + 1 : 1,
        until: limit && limit.until > now ? limit.until : now + 900000,
      })
      throw new BadRequestException('当前密码不正确')
    }
    if (body.currentPassword === body.newPassword) throw new BadRequestException('新密码不能与当前密码相同')
    const passwordHash = hashPassword(body.newPassword as string)
    await db.$transaction(async (tx) => {
      const result = await tx.adminUser.updateMany({
        where: { id: admin.id, passwordVersion: admin.passwordVersion },
        data: { passwordHash, passwordVersion: { increment: 1 } },
      })
      if (!result.count) throw new BadRequestException('密码已变更，请重新登录')
      await tx.auditLog.create({
        data: { actorId: admin.id, action: '修改登录密码', targetId: admin.id, traceId: req.traceId!, diff: {} },
      })
    })
    failedLogins.delete(key)
    return { data: { changed: true } }
  }

  @Get('auth/profile') async profile(@Req() req: AuthRequest) {
    const row = await db.systemConfig.findUnique({ where: { key: 'profile:' + req.actor!.id } })
    const extra = (row?.value as { nickname?: string; avatar?: string | null } | undefined) || {}
    return { data: { ...req.actor, nickname: extra.nickname || '', avatar: extra.avatar || null } }
  }
  /** 个人信息：昵称与头像（头像由前端压缩为 ≤256px 的 data URL） */
  @Put('auth/profile') async updateProfile(@Body() body: { nickname?: unknown; avatar?: unknown }, @Req() req: AuthRequest) {
    const key = 'profile:' + req.actor!.id
    const row = await db.systemConfig.findUnique({ where: { key } })
    const current = (row?.value as { nickname?: string; avatar?: string | null } | undefined) || {}
    const next = { ...current }
    if (body?.nickname !== undefined) {
      if (typeof body.nickname !== 'string' || body.nickname.trim().length > 30) throw new BadRequestException('昵称最多 30 个字')
      next.nickname = body.nickname.trim()
    }
    if (body?.avatar !== undefined) {
      if (body.avatar !== null && (typeof body.avatar !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(body.avatar) || body.avatar.length > 120000))
        throw new BadRequestException('头像格式不正确或文件过大')
      next.avatar = body.avatar as string | null
    }
    await db.systemConfig.upsert({ where: { key }, create: { key, value: next }, update: { value: next, version: { increment: 1 } } })
    return { data: { ...req.actor, nickname: next.nickname || '', avatar: next.avatar || null } }
  }
  @Get('dashboard/overview') async overview() {
    return { data: await business.overview() }
  }
  @Get('dashboard/trends') async trends(@Query('days') days: string) {
    return { data: await business.trends([7, 30, 90].includes(Number(days)) ? Number(days) : 7) }
  }
  @Get('users') async users() {
    return { data: await business.listUsers() }
  }
  @Patch('orders/:id/user') async assignOrder(@Param('id') id: string, @Body() body: { userId?: string | null }, @Req() req: AuthRequest) {
    const order = await db.affiliateOrder.findUnique({ where: { id } })
    if (!order) throw new NotFoundException('订单不存在')
    const userId = body?.userId || null
    if (userId && !(await db.user.findUnique({ where: { id: userId } }))) throw new NotFoundException('用户不存在')
    // 同一订单号的所有订单行一起关联
    await db.$transaction([
      db.affiliateOrder.updateMany({
        where: { platform: order.platform, accountId: order.accountId, externalOrderId: order.externalOrderId },
        data: { userId },
      }),
      db.auditLog.create({
        data: { actorId: req.actor!.id, action: userId ? '手动关联订单用户' : '取消订单关联', targetId: order.externalOrderId, traceId: req.traceId!, diff: { from: order.userId, to: userId } },
      }),
    ])
    return { data: { ok: true } }
  }
  @Patch('users/:id') async updateUser(
    @Param('id') id: string,
    @Body() body: { ratio?: number; status?: string },
    @Req() req: AuthRequest,
  ) {
    if (body.ratio !== undefined && (!Number.isInteger(body.ratio) || body.ratio < 0 || body.ratio > 100))
      throw new BadRequestException('比例需为 0–100 的整数')
    if (body.status !== undefined && !['ACTIVE', 'DISABLED'].includes(body.status))
      throw new BadRequestException('账户状态无效')
    if (!(await db.user.findUnique({ where: { id } }))) throw new NotFoundException('用户不存在')
    await db.$transaction(async (tx) => {
      if (body.status !== undefined)
        await tx.user.update({ where: { id }, data: { enabled: body.status === 'ACTIVE' } })
      if (body.ratio !== undefined)
        await tx.rebateRule.upsert({
          where: { scopeKey: `user:${id}` },
          create: { scopeKey: `user:${id}`, userId: id, basisPoints: body.ratio * 100 },
          update: { basisPoints: body.ratio * 100, version: { increment: 1 } },
        })
      await tx.auditLog.create({
        data: {
          actorId: req.actor!.id,
          action: '编辑用户',
          targetId: id,
          traceId: req.traceId!,
          diff: { ratio: body.ratio, status: body.status },
        },
      })
    })
    return { data: { id } }
  }
  @Get('promotions') async promotions() {
    return { data: await business.listPromotions() }
  }
  @Post('promotions/convert') async convert(@Body() body: { content?: unknown }, @Req() req: AuthRequest) {
    if (typeof body.content !== 'string' || body.content.length > 3000)
      throw new BadRequestException('请输入有效商品链接')
    return { data: await business.convert(body.content, req.actor!.id, req.traceId!) }
  }
  @Get('orders') async orders() {
    return { data: await business.listOrders() }
  }
  @Get('platforms') plugins() {
    return {
      data: listPlatforms().map((p) => ({
        id: p.id,
        name: p.name,
        authentication: p.authentication,
        documentationUrl: p.documentationUrl,
        maxHistoryDays: p.maxHistoryDays,
      })),
    }
  }
  @Get('orders/sync-status') syncStatus() {
    return orderSyncStatus().then((data) => ({ data }))
  }
  @Post('orders/sync') async sync(@Req() req: AuthRequest, @Body() body: { platform?: string; hours?: number }) {
    return { data: await startOrderSync(req.actor!.id, req.traceId!, body || {}) }
  }
  @Get('rebates') async rebates() {
    return {
      data: (
        await db.walletTransaction.findMany({
          include: { wallet: { include: { user: true } } },
          orderBy: { createdAt: 'desc' },
        })
      ).map((r) => ({
        id: r.id,
        user: r.wallet.user.name,
        orderId: r.referenceId,
        type: `${r.kind} · ${r.bucket}`,
        amount: centsNumber(r.deltaCents),
        before: centsNumber(r.beforeCents),
        after: centsNumber(r.afterCents),
        createdAt: dateText(r.createdAt),
        source: r.actorId ? '管理员' : '系统',
      })),
    }
  }
  @Get('withdrawals') async withdrawals() {
    return { data: await business.listWithdrawals() }
  }
  @Post('withdrawals/:id/:action') async withdrawal(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: { note?: unknown; proof?: unknown },
    @Req() req: AuthRequest,
  ) {
    if (
      (body.note !== undefined && typeof body.note !== 'string') ||
      (body.proof !== undefined && typeof body.proof !== 'string')
    )
      throw new BadRequestException('备注和凭证格式无效')
    const note = String(body.note || ''),
      proof = String(body.proof || '')
    if (note.length > 500 || proof.length > 120) throw new BadRequestException('内容超长')
    return { data: await business.withdrawalAction(id, action, note, proof, req.actor!.id, req.traceId!) }
  }
  @Get('settings') async settings() {
    return { data: await business.settings() }
  }
  @Put('settings') async saveSettings(@Body() body: { ratio: number; minimum: number }, @Req() req: AuthRequest) {
    if (
      !Number.isInteger(body.ratio) ||
      body.ratio < 0 ||
      body.ratio > 100 ||
      !Number.isInteger(body.minimum) ||
      body.minimum < 1 ||
      body.minimum > 100000
    )
      throw new BadRequestException('请填写有效比例与最低提现整数元')
    const value = { ratio: body.ratio, minimum: body.minimum }
    await db.$transaction([
      db.systemConfig.upsert({
        where: { key: 'rules' },
        create: { key: 'rules', value },
        update: { value, version: { increment: 1 } },
      }),
      db.auditLog.create({
        data: { actorId: req.actor!.id, action: '修改默认规则', targetId: 'rules', traceId: req.traceId!, diff: value },
      }),
    ])
    return { data: value }
  }
  @Get('audit-logs') async logs() {
    return {
      data: (await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })).map((l) => ({
        id: l.id,
        action: l.action,
        target: l.targetId,
        actor: l.actorId,
        createdAt: l.createdAt.toISOString(),
      })),
    }
  }
  @Get('service-status') async serviceStatus() {
    return {
      data: await Promise.all(
        (['jd', 'taobao', 'wecom'] as const).map(async (kind) => {
          const s = await integrationStatus(kind)
          return { kind, configured: s.configured, test: s.test }
        }),
      ),
    }
  }
  @Get('integrations/:kind') async integration(@Param('kind') kind: string) {
    return { data: await integrationStatus(provider(kind)) }
  }
  @Get('system/logs') systemLogs(@Query('after') after?: string) {
    return { data: readLogs(Number(after) || 0) }
  }
  @Get('system/logs/download') downloadLogs(@Res() res: Response) {
    res.setHeader('Content-Disposition', `attachment; filename="shop-cashback-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.log"`)
    res.type('text/plain; charset=utf-8').send(logText())
  }
  @Get('system/update') async systemUpdate() {
    return { data: await updateStatus() }
  }
  @Post('system/update') async runSystemUpdate(@Req() req: AuthRequest) {
    const data = await startUpdate()
    await audit(req.actor!.id, '一键更新', 'system', req.traceId!, { fromVersion: appVersion.version })
    return { data }
  }
  @Get('wecom/menu') async menu() { return { data: await getMenu() } }
  @Put('wecom/menu') async saveMenu(@Body() body: { draft?: unknown }, @Req() req: AuthRequest) {
    return { data: await saveMenu(body?.draft, req.actor!.id, req.traceId!) }
  }
  @Post('wecom/menu/publish') async publishMenu(@Body() body: { draft?: unknown }, @Req() req: AuthRequest) {
    return { data: await publishMenu(body?.draft, req.actor!.id, req.traceId!) }
  }
  @Post('integrations/:kind/details') async integrationDetails(@Param('kind') kind: string, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    if (req.actor!.role !== 'SUPER_ADMIN') throw new ForbiddenException('仅超级管理员可查看配置详情')
    const id = provider(kind)
    const status = await integrationStatus(id)
    const config = await readConfig(id)
    res.setHeader('Cache-Control', 'no-store')
    await audit(req.actor!.id, '查看平台配置详情', id, req.traceId!)
    return { data: { ...status, fields: status.fields.map((field) => ({ ...field, value: config[field.key] || '' })) } }
  }
  @Put('integrations/:kind') async saveIntegration(
    @Param('kind') kind: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return { data: await saveConfig(provider(kind), body, req.actor!.id, req.traceId!) }
  }
  @Post('integrations/:kind/test') async testIntegration(@Param('kind') kind: string, @Req() req: AuthRequest) {
    return { data: await testConnection(provider(kind), req.actor!.id, req.traceId!) }
  }
}
function provider(kind: string): Provider {
  if (kind !== 'wecom') platform(kind)
  return kind
}
@Module({ controllers: [PublicController, AdminController], providers: [AuthGuard] })
class AppModule {}
async function bootstrap() {
  console.log(versionText())
  await db.$connect()
  const app = await NestFactory.create(AppModule, { logger: new AppLogger() })
  app.use(
    helmet({
      // 未配置 HTTPS 时 HSTS 无意义，并会让同域名后续访问被强制跳转 https。
      strictTransportSecurity: false,
      contentSecurityPolicy: {
        directives: {
          // 商品图片来自京东等平台 CDN，需允许 HTTPS 图片。
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          // 允许通过 http://IP:端口 直接访问；否则浏览器会把脚本请求强制升级为 https 导致页面空白。
          upgradeInsecureRequests: null,
        },
      },
    }),
  )
  // 单镜像部署：同一进程提供后台静态页面；/api 之外的 GET 请求回退到 index.html。
  const adminDist = env.ADMIN_DIST || resolve(__dirname, '../../admin/dist')
  if (existsSync(join(adminDist, 'index.html'))) {
    app.use(
      serveStatic(adminDist, {
        index: false,
        setHeaders: (res, file) =>
          res.setHeader('Cache-Control', file.startsWith(join(adminDist, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache'),
      }),
    )
    app.use((req: Request, res: Response, next: () => void) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/')) return next()
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(join(adminDist, 'index.html'))
    })
  }
  app.use('/api/v1/callbacks/wecom', text({ type: ['text/xml', 'application/xml'], limit: '64kb' }))
  const buckets = new Map<string, { count: number; until: number }>()
  app.use((req: AuthRequest, res: Response, next: () => void) => {
    req.traceId = randomUUID()
    res.setHeader('X-Trace-Id', req.traceId)
    const now = Date.now(),
      key = req.ip || 'local'
    if (buckets.size > 10000) for (const [k, b] of buckets) if (b.until < now) buckets.delete(k)
    const previous = buckets.get(key),
      b = previous && previous.until > now ? previous : { count: 0, until: now + 60000 }
    b.count++
    buckets.set(key, b)
    if (b.count > 180) {
      res.status(429).json({ message: '请求过于频繁', traceId: req.traceId })
      return
    }
    next()
  })
  app.useGlobalFilters(new Errors())
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('拾惠返利 API').setVersion(appVersion.version).addBearerAuth().build(),
    ),
  )
  await app.listen(Number(env.PORT || 3001), env.HOST || '127.0.0.1')
  const timer = setInterval(() => void processInbox().catch(() => console.error('Inbox worker unavailable')), 3000)
  timer.unref()
  const orderTimer = setInterval(
    () => void processOrderSync().catch(() => console.error('Order sync worker unavailable')),
    2000,
  )
  orderTimer.unref()
  // 自动同步最近订单：按转链活跃度在 15 秒～10 分钟之间动态调整间隔
  startAutoSync()
  app.enableShutdownHooks()
}
void bootstrap().catch(() => {
  console.error('启动失败：请检查数据库、迁移与服务端环境变量')
  process.exitCode = 1
})
