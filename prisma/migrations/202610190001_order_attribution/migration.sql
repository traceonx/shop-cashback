-- 订单用户归属方式（TRACKING / PRODUCT / SIBLING / MANUAL）
ALTER TABLE "affiliate_orders" ADD COLUMN "attribution" TEXT;
