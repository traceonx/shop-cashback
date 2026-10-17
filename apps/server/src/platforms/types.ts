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
  convert(
    config: PlatformConfig,
    url: string,
    trackingCode?: string,
  ): Promise<{
    link: string
    snapshot: {
      product: string
      price: number | null
      imageUrl: string | null
      commission: number | null
      coupon: number | null
      payablePrice?: number | null
      infoMessage?: string
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
