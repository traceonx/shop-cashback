import type { ConfigField } from '../types'

// Configuration is available before the trading adapter is enabled.
export const taobaoFields: readonly ConfigField[] = [
  ['appKey', 'AppKey', false],
  ['appSecret', 'AppSecret', true],
  ['pid', '推广位 PID（mm_账号_媒体_推广位）', false],
  ['adzoneId', '推广位 ID（从 PID 自动提取）', false],
]
