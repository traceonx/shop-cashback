ALTER TABLE "affiliate_orders" ALTER COLUMN "amountCents" DROP NOT NULL;
ALTER TABLE "affiliate_orders" ADD COLUMN "paidAmountCents" BIGINT,
ADD COLUMN "completedAt" TIMESTAMP(3);
