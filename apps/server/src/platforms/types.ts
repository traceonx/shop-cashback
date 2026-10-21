export type PlatformConfig = Record<string, string>
export type ConfigField = readonly [key: string, label: string, secret: boolean]
/** INVALID：联盟判定的无效订单行（如京东拆单后的父单），不是用户取消，不产生返现、也不通知用户 */
export type PlatformOrderStatus = 'CANCELLED' | 'CREATED' | 'PAID' | 'COMPLETED' | 'INVALID' | 'UNATTRIBUTED'
export interface PlatformOrder {
  trackingCode: string | null
  /** 订单推广位 ID（京东 positionId），用户独立推广位时据此关联用户 */
  positionId?: string | null
  status: PlatformOrderStatus
  orderId: string
  lineId: string
  rawStatus: string
  raw: unknown
  placedAt: Date
  completedAt: Date | null
  commissionCents: number | null
  commissionBaseCents: number
  sku: string
  title: string
  quantity: number
}
export interface PlatformPlugin {
  id: string
  name: string
  accountId: string
  documentationUrl: string
  authentication: { mode: 'app-credentials'; description: string }
  fields: readonly ConfigField[]
  maxHistoryDays: number
  maxWindowMs: number
  orderImage(raw: unknown): string | null
  /** estimate：预估佣金（完成后 commission 为实际佣金，两者可能不同，如退货） */
  orderAmounts(raw: unknown): { amount: number | null; commission: number | null; commissionBase: number | null; estimate?: number | null }
  orderStatus(rawStatus: string): PlatformOrderStatus
  /** 联盟原始订单状态的中文名（后台原样展示），未知状态码返回 null */
  orderStatusText?(rawStatus: string): string | null
  /** 佣金结算状态：SETTLED 已结算（settledAt 为结算日期文本）、PENDING 未结算（expectedAt 为联盟给出的预计结算日期）、INVALID 已失效 */
  orderSettlement?(raw: unknown): { state: 'SETTLED' | 'PENDING' | 'INVALID'; settledAt: string | null; expectedAt?: string | null }
  /** 商品数量与退货数量（联盟未提供时为 null） */
  orderReturns?(raw: unknown): { quantity: number; returned: number } | null
  configured(config: PlatformConfig): boolean
  normalizeUrl(content: string): string
  /** 是否已接入订单同步（未接入的平台不参与自动同步） */
  orderSync?: boolean
  convert(
    config: PlatformConfig,
    url: string,
    trackingCode?: string,
    /** 用户发送的原始内容（分享文案），可从中取商品标题等辅助信息 */
    content?: string,
  ): Promise<{
    link: string
    snapshot: {
      product: string
      /** 商品 SKU，用于订单未回传用户标识时按商品匹配下单用户 */
      sku?: string
      price: number | null
      imageUrl: string | null
      commission: number | null
      coupon: number | null
      payablePrice?: number | null
      password?: string
      infoMessage?: string
      /** 店铺名（按标题搜索转链时返回，便于用户核对是否同一家店） */
      shop?: string
      rebate: number | null
      finalPrice: number | null
      category: string
      trackingVerified: false
    }
  }>
  test(config: PlatformConfig): Promise<string>
  queryOrders(
    config: PlatformConfig,
    /** position：上一页返回的翻页位点（淘宝 position_index），由同步任务持久化，重启后可继续 */
    request: { from: Date; until: Date; page: number; type: 1 | 3; position?: string | null; webUntil?: Date },
  ): Promise<{ rows: PlatformOrder[]; hasMore: boolean; position?: string | null; source?: string }>
}
