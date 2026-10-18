// 极简 5 段 cron 表达式（分 时 日 月 周），支持 *、数字、a-b 区间、逗号列表和 /步长；周日可写 0 或 7。
// 按 CRON_TZ（默认 Asia/Shanghai）的本地时间计算，容器默认是 UTC 也不影响。
const zone = process.env.CRON_TZ || process.env.TZ || 'Asia/Shanghai'
const ranges: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
]
const names = ['分钟', '小时', '日', '月', '星期']

function field(text: string, i: number) {
  const [min, max] = ranges[i]
  const set = new Set<number>()
  for (const part of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!m) throw new Error(`${names[i]}字段「${part}」格式不正确`)
    const step = m[2] ? Number(m[2]) : 1
    let [a, b] = m[1] === '*' ? [min, max] : m[1].split('-').map(Number)
    if (b === undefined) b = m[2] ? max : a
    if (a < min || b > max || a > b || step < 1) throw new Error(`${names[i]}字段「${part}」超出范围 ${min}-${max}`)
    for (let v = a; v <= b; v += step) set.add(i === 4 && v === 7 ? 0 : v)
  }
  return set
}

export type Cron = { fields: Set<number>[]; anyDay: boolean; anyWeek: boolean }
export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('cron 表达式需要 5 段：分 时 日 月 周，例如 0 4 * * *')
  return { fields: parts.map(field), anyDay: parts[2] === '*', anyWeek: parts[4] === '*' }
}

const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short' })
const week: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
function parts(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]))
  return [Number(p.minute), Number(p.hour), Number(p.day), Number(p.month), week[p.weekday]]
}

/** 某一分钟是否命中；日和周都限定时满足其一即可（与标准 cron 一致） */
export function cronMatches(c: Cron, d: Date) {
  const [mi, h, day, mon, wd] = parts(d)
  if (!c.fields[0].has(mi) || !c.fields[1].has(h) || !c.fields[3].has(mon)) return false
  const dayOk = c.fields[2].has(day),
    weekOk = c.fields[4].has(wd)
  return c.anyDay || c.anyWeek ? dayOk && weekOk : dayOk || weekOk
}

/** 下一次执行时间（最多向后查找一年） */
export function nextCron(c: Cron, from = new Date()) {
  const t = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000)
  for (let i = 0; i < 366 * 1440; i++, t.setTime(t.getTime() + 60000)) if (cronMatches(c, t)) return new Date(t)
  return null
}
