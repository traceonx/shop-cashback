-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'FINANCE', 'USER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'PAID', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'INVALID', 'SETTLED', 'UNATTRIBUTED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'PENDING_PAYMENT', 'COMPLETED', 'REJECTED', 'PAYMENT_FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_configs" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "encryptedConfig" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_platforms" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_accounts" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "trackingVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_configs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "encryptedConfig" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tracking_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_tracking_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "raw" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "trackingCode" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "promotionUrl" TEXT,
    "productSnapshot" JSONB,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_orders" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "externalLineId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'UNATTRIBUTED',
    "rawStatus" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "commissionCents" BIGINT,
    "rebateCents" BIGINT,
    "ruleSnapshot" JSONB,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebate_rules" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "userId" TEXT,
    "platform" TEXT,
    "basisPoints" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rebate_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebate_records" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rebate_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pendingCents" BIGINT NOT NULL DEFAULT 0,
    "availableCents" BIGINT NOT NULL DEFAULT 0,
    "frozenCents" BIGINT NOT NULL DEFAULT 0,
    "withdrawnCents" BIGINT NOT NULL DEFAULT 0,
    "totalCents" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "deltaCents" BIGINT NOT NULL,
    "beforeCents" BIGINT NOT NULL,
    "afterCents" BIGINT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "encryptedPayee" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_payments" (
    "id" TEXT NOT NULL,
    "withdrawalId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "proofObjectKey" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_records" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_messages" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incoming_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cursor" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_channelId_externalUserId_key" ON "user_identities"("channelId", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_configs_channelId_key" ON "channel_configs"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_platforms_code_key" ON "affiliate_platforms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_accounts_platformId_externalId_key" ON "affiliate_accounts"("platformId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_configs_accountId_key" ON "affiliate_configs"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "user_tracking_codes_accountId_code_key" ON "user_tracking_codes"("accountId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "user_tracking_codes_accountId_userId_key" ON "user_tracking_codes"("accountId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "products_platform_sku_key" ON "products"("platform", "sku");

-- CreateIndex
CREATE INDEX "promotion_records_userId_createdAt_idx" ON "promotion_records"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "affiliate_orders_userId_placedAt_idx" ON "affiliate_orders"("userId", "placedAt");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_orders_platform_accountId_externalOrderId_externa_key" ON "affiliate_orders"("platform", "accountId", "externalOrderId", "externalLineId");

-- CreateIndex
CREATE UNIQUE INDEX "order_status_history_eventKey_key" ON "order_status_history"("eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "rebate_rules_scopeKey_key" ON "rebate_rules"("scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "rebate_records_businessKey_key" ON "rebate_records"("businessKey");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_accounts_userId_key" ON "wallet_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_businessKey_key" ON "wallet_transactions"("businessKey");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_createdAt_idx" ON "wallet_transactions"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_requests_idempotencyKey_key" ON "withdrawal_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "withdrawal_requests_userId_createdAt_idx" ON "withdrawal_requests"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_payments_idempotencyKey_key" ON "withdrawal_payments"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_eventKey_key" ON "notification_events"("eventKey");

-- CreateIndex
CREATE INDEX "notification_events_publishedAt_createdAt_idx" ON "notification_events"("publishedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_records_eventId_attempt_key" ON "notification_records"("eventId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_messages_channelId_externalId_key" ON "incoming_messages"("channelId", "externalId");

-- CreateIndex
CREATE INDEX "audit_logs_targetId_createdAt_idx" ON "audit_logs"("targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_configs" ADD CONSTRAINT "channel_configs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_accounts" ADD CONSTRAINT "affiliate_accounts_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "affiliate_platforms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_configs" ADD CONSTRAINT "affiliate_configs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "affiliate_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tracking_codes" ADD CONSTRAINT "user_tracking_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tracking_codes" ADD CONSTRAINT "user_tracking_codes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "affiliate_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_records" ADD CONSTRAINT "promotion_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_orders" ADD CONSTRAINT "affiliate_orders_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "affiliate_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_orders" ADD CONSTRAINT "affiliate_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_order_items" ADD CONSTRAINT "affiliate_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "affiliate_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "affiliate_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebate_records" ADD CONSTRAINT "rebate_records_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "affiliate_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_payments" ADD CONSTRAINT "withdrawal_payments_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "withdrawal_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_records" ADD CONSTRAINT "notification_records_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "notification_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
