export type PlatformConfig = Record<string, string>
export type ConfigField = readonly [key: string, label: string, secret: boolean]
export type PlatformOrderStatus = 'CANCELLED' | 'CREATED' | 'PAID' | 'COMPLETED' | 'UNATTRIBUTED'
export interface PlatformOrder {
  trackingCode: string | null
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
  orderAmounts(raw: unknown): { amount: number | null; commission: number | null; commissionBase: number | null }
  orderStatus(rawStatus: string): PlatformOrderStatus
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
    request: { from: Date; until: Date; page: number; type: 1 | 3 },
  ): Promise<{ rows: PlatformOrder[]; hasMore: boolean }>
}
