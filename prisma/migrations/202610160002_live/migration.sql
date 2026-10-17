ALTER TABLE "promotion_records" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "incoming_messages" ADD COLUMN "payload" JSONB,
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lockedUntil" TIMESTAMP(3),
ADD COLUMN "errorCode" TEXT;
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_nonnegative" CHECK ("availableCents" >= 0 AND "frozenCents" >= 0 AND "withdrawnCents" >= 0);
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_positive" CHECK ("amountCents" > 0);
ALTER TABLE "rebate_rules" ADD CONSTRAINT "ratio_range" CHECK ("basisPoints" BETWEEN 0 AND 10000);
