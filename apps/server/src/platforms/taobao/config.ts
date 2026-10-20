import type { ConfigField } from '../types'

// Configuration is available before the trading adapter is enabled.
export const taobaoFields: readonly ConfigField[] = [
  ['appKey', 'AppKey', false],
  ['appSecret', 'AppSecret', true],
  ['pid', '推广位 PID（mm_账号_媒体_推广位）', false],
  ['adzoneId', '推广位 ID（从 PID 自动提取）', false],
  ['orderSource', '订单数据源', false],
  ['publicUrl', '外部访问地址（淘宝授权回调用）', false],
  ['autoMatch', '按商品自动关联用户', false],
  ['perUserAdzone', '每个用户独立推广位', false],
  ['adzonePool', '推广位池（每行一个 PID）', false],
  ['webMode', '网页备用通道', false],
  ['webRpm', '网页每分钟请求上限', false],
  ['webHealthMinutes', '网页登录检查间隔（分钟）', false],
  ['webLookbackDays', '网页订单回溯天数', false],
]
