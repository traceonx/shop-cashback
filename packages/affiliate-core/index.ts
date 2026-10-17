/** Contracts for future verified provider implementations. No real adapter is enabled. */
export interface ProductInfo {
  sku: string
  name: string
  imageUrl?: string
  priceCents: bigint | null
  coupon: { amountCents: bigint; minimumCents: bigint; expiresAt: Date; verified: boolean } | null
  commissionCents: bigint | null
}
export interface PromotionResult {
  platform: string
  promotionUrl: string
  trackingId: string
  product: ProductInfo | null
}
export interface AffiliateOrder {
  platform: string
  accountId: string
  orderId: string
  lineId: string
  trackingId: string | null
  rawStatus: string
  raw: unknown
}
export interface AffiliateAdapter {
  platform: string
  matchUrl(url: URL): boolean
  convert(url: URL, trackingId: string): Promise<PromotionResult>
  getProductInfo(url: URL): Promise<ProductInfo | null>
  queryOrders(params: { from: Date; to: Date; cursor?: string }): Promise<{ orders: AffiliateOrder[]; cursor?: string }>
}
