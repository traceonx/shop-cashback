// 运行日志：拦截 console 与 Nest 日志，保留最近 2000 条于内存，供后台「实时日志」查看与下载
import { ConsoleLogger } from '@nestjs/common'
import { format } from 'node:util'

export type Level = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
export type Entry = { id: number; time: string; level: Level; source: string; message: string }
const MAX = 2000
const entries: Entry[] = []
let seq = 0

export function record(level: Level, source: string, message: string) {
  const text = message.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trimEnd()
  if (!text) return
  entries.push({ id: ++seq, time: new Date().toISOString(), level, source: source || 'app', message: text })
  if (entries.length > MAX) entries.splice(0, entries.length - MAX)
}
export const readLogs = (after = 0, limit = MAX) => {
  const list = entries.filter((e) => e.id > after)
  return { entries: list.slice(-limit), lastId: seq }
}
export const logText = () =>
  entries.map((e) => `${e.time} ${e.level.padEnd(7)} [${e.source}] ${e.message}`).join('\n') + '\n'

// console.* → 日志；以 “[来源]” 开头的消息提取来源，例如 “[企业微信] 回调验证成功”
const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }
function wrap(method: keyof typeof original, level: Level) {
  console[method] = (...args: unknown[]) => {
    original[method].apply(console, args)
    const text = format(...args)
    const m = /^\[([^\]]{1,20})\]\s*/.exec(text)
    record(level, m ? m[1] : 'app', m ? text.slice(m[0].length) : text)
  }
}
wrap('log', 'INFO')
wrap('info', 'INFO')
wrap('warn', 'WARNING')
wrap('error', 'ERROR')
wrap('debug', 'DEBUG')

// Nest 框架日志：启动时的路由映射等降为 DEBUG，避免刷屏
const quiet = new Set(['RouterExplorer', 'RoutesResolver', 'InstanceLoader'])
export class AppLogger extends ConsoleLogger {
  private keep(level: Level, message: unknown, rest: unknown[]) {
    const context = typeof rest[rest.length - 1] === 'string' ? (rest[rest.length - 1] as string) : this.context || 'Nest'
    const stack = level === 'ERROR' && typeof rest[0] === 'string' && rest.length > 1 ? `\n${rest[0]}` : ''
    record(quiet.has(context) && level === 'INFO' ? 'DEBUG' : level, context, (message instanceof Error ? message.stack || message.message : typeof message === 'string' ? message : format(message)) + stack)
  }
  log(message: unknown, ...rest: unknown[]) { this.keep('INFO', message, rest); super.log(message, ...(rest as [])) }
  warn(message: unknown, ...rest: unknown[]) { this.keep('WARNING', message, rest); super.warn(message, ...(rest as [])) }
  error(message: unknown, ...rest: unknown[]) { this.keep('ERROR', message, rest); super.error(message, ...(rest as [])) }
  debug(message: unknown, ...rest: unknown[]) { this.keep('DEBUG', message, rest); super.debug(message, ...(rest as [])) }
  verbose(message: unknown, ...rest: unknown[]) { this.keep('DEBUG', message, rest); super.verbose(message, ...(rest as [])) }
}
