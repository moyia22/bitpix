CREATE TYPE "PrintJobType" AS ENUM ('PIX_CHARGE_TICKET', 'PIX_PAYMENT_RECEIPT');
CREATE TYPE "PixPaymentStatus" AS ENUM ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');
CREATE TYPE "PixRefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'CANCELLED');
CREATE TYPE "NotificationType" AS ENUM ('PAYMENT_VALUE_MISMATCH', 'PAYMENT_AFTER_CASH_CLOSE', 'WEBHOOK_UNRESOLVED', 'WEBHOOK_DEAD_LETTER', 'CASH_CLOSED_WITH_PENDING_CHARGES');
CREATE TYPE "NotificationStatus" AS ENUM ('OPEN', 'READ', 'RESOLVED');

ALTER TYPE "CashMovementSourceType" ADD VALUE 'PIX_PAYMENT';
ALTER TYPE "CashMovementSourceType" ADD VALUE 'PIX_REFUND';
ALTER TYPE "SaleStatus" ADD VALUE 'VALUE_MISMATCH';
ALTER TYPE "SaleStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "SaleStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "WebhookEventStatus" ADD VALUE 'SIGNATURE_VALID';
ALTER TYPE "WebhookEventStatus" ADD VALUE 'SIGNATURE_INVALID';
ALTER TYPE "WebhookEventStatus" ADD VALUE 'IGNORED';
ALTER TYPE "WebhookEventStatus" ADD VALUE 'RETRYING';
ALTER TYPE "WebhookEventStatus" ADD VALUE 'DEAD_LETTER';

ALTER TABLE "CashSession"
  ADD COLUMN "closedWithPendingCharges" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hasPostCloseAdjustment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "postCloseAdjustmentAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "paymentSoundEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "paymentSoundEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "PixCharge"
  ADD COLUMN "expectedAmount" DECIMAL(18,2),
  ADD COLUMN "receivedAmount" DECIMAL(18,2),
  ADD COLUMN "providerCreatedAt" TIMESTAMP(3),
  ADD COLUMN "providerUpdatedAt" TIMESTAMP(3);
UPDATE "PixCharge" SET "expectedAmount" = "amount" WHERE "expectedAmount" IS NULL;

ALTER TABLE "ProviderConfiguration"
  ADD COLUMN "webhookSecretCiphertext" TEXT,
  ADD COLUMN "webhookSecretIv" VARCHAR(32),
  ADD COLUMN "webhookSecretAuthTag" VARCHAR(64),
  ADD COLUMN "webhookSecretMasked" VARCHAR(80);

ALTER TABLE "WebhookEvent"
  ADD COLUMN "pixChargeId" TEXT,
  ADD COLUMN "requestId" VARCHAR(120),
  ADD COLUMN "correlationId" UUID,
  ADD COLUMN "signatureValid" BOOLEAN,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextRetryAt" TIMESTAMP(3),
  ADD COLUMN "deadLetterReason" VARCHAR(240);
UPDATE "WebhookEvent" SET "correlationId" = gen_random_uuid() WHERE "correlationId" IS NULL;
ALTER TABLE "WebhookEvent" ALTER COLUMN "correlationId" SET NOT NULL;

ALTER TABLE "WebhookAttempt"
  ADD COLUMN "correlationId" UUID,
  ADD COLUMN "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "finishedAt" TIMESTAMP(3),
  ADD COLUMN "durationMs" INTEGER,
  ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false;
UPDATE "WebhookAttempt" SET "correlationId" = gen_random_uuid() WHERE "correlationId" IS NULL;
ALTER TABLE "WebhookAttempt" ALTER COLUMN "correlationId" SET NOT NULL;

ALTER TABLE "PrintJob"
  ADD COLUMN "pixPaymentId" TEXT,
  ADD COLUMN "type" "PrintJobType" NOT NULL DEFAULT 'PIX_CHARGE_TICKET',
  ALTER COLUMN "pixChargeId" DROP NOT NULL;

CREATE TABLE "PixPayment" (
  "id" TEXT NOT NULL,
  "publicId" UUID NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "pixChargeId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "cashSessionId" TEXT NOT NULL,
  "provider" "ProviderName" NOT NULL,
  "providerPaymentId" VARCHAR(120) NOT NULL,
  "providerOrderId" VARCHAR(120),
  "externalReference" VARCHAR(120) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
  "status" "PixPaymentStatus" NOT NULL DEFAULT 'PAID',
  "paidAt" TIMESTAMP(3) NOT NULL,
  "providerCreatedAt" TIMESTAMP(3),
  "providerUpdatedAt" TIMESTAMP(3),
  "payerDataSanitized" JSONB,
  "providerResponseSanitized" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PixPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PixPayment_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE "PixRefund" (
  "id" TEXT NOT NULL,
  "publicId" UUID NOT NULL,
  "companyId" TEXT NOT NULL,
  "pixPaymentId" TEXT NOT NULL,
  "providerRefundId" VARCHAR(120),
  "amount" DECIMAL(18,2) NOT NULL,
  "status" "PixRefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedByUserId" TEXT NOT NULL,
  "reason" VARCHAR(240) NOT NULL,
  "idempotencyKey" UUID NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "providerResponseSanitized" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PixRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PixRefund_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "publicId" UUID NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "type" "NotificationType" NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'OPEN',
  "title" VARCHAR(120) NOT NULL,
  "message" VARCHAR(300) NOT NULL,
  "entityType" VARCHAR(80) NOT NULL,
  "entityPublicId" VARCHAR(120),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PixPayment_publicId_key" ON "PixPayment"("publicId");
CREATE UNIQUE INDEX "PixPayment_pixChargeId_key" ON "PixPayment"("pixChargeId");
CREATE UNIQUE INDEX "PixPayment_saleId_key" ON "PixPayment"("saleId");
CREATE UNIQUE INDEX "PixPayment_provider_providerPaymentId_key" ON "PixPayment"("provider", "providerPaymentId");
CREATE INDEX "PixPayment_companyId_paidAt_idx" ON "PixPayment"("companyId", "paidAt");
CREATE INDEX "PixPayment_branchId_paidAt_idx" ON "PixPayment"("branchId", "paidAt");
CREATE INDEX "PixPayment_cashSessionId_paidAt_idx" ON "PixPayment"("cashSessionId", "paidAt");
CREATE INDEX "PixPayment_externalReference_idx" ON "PixPayment"("externalReference");

CREATE UNIQUE INDEX "PixRefund_publicId_key" ON "PixRefund"("publicId");
CREATE UNIQUE INDEX "PixRefund_idempotencyKey_key" ON "PixRefund"("idempotencyKey");
CREATE UNIQUE INDEX "PixRefund_companyId_providerRefundId_key" ON "PixRefund"("companyId", "providerRefundId");
CREATE INDEX "PixRefund_pixPaymentId_createdAt_idx" ON "PixRefund"("pixPaymentId", "createdAt");
CREATE INDEX "PixRefund_companyId_status_createdAt_idx" ON "PixRefund"("companyId", "status", "createdAt");

CREATE UNIQUE INDEX "Notification_publicId_key" ON "Notification"("publicId");
CREATE INDEX "Notification_companyId_status_createdAt_idx" ON "Notification"("companyId", "status", "createdAt");
CREATE INDEX "Notification_entityType_entityPublicId_idx" ON "Notification"("entityType", "entityPublicId");

CREATE UNIQUE INDEX "CashMovement_companyId_sourceType_sourceId_key" ON "CashMovement"("companyId", "sourceType", "sourceId");
CREATE UNIQUE INDEX "PixCharge_provider_providerOrderId_key" ON "PixCharge"("provider", "providerOrderId");
CREATE UNIQUE INDEX "PixCharge_provider_providerPaymentId_key" ON "PixCharge"("provider", "providerPaymentId");
CREATE UNIQUE INDEX "PixChargeStatusHistory_pixChargeId_providerEventId_key" ON "PixChargeStatusHistory"("pixChargeId", "providerEventId");
CREATE UNIQUE INDEX "WebhookEvent_provider_externalEventId_key" ON "WebhookEvent"("provider", "externalEventId");
CREATE INDEX "WebhookEvent_pixChargeId_receivedAt_idx" ON "WebhookEvent"("pixChargeId", "receivedAt");
CREATE INDEX "WebhookEvent_status_nextRetryAt_idx" ON "WebhookEvent"("status", "nextRetryAt");
CREATE INDEX "PrintJob_pixPaymentId_createdAt_idx" ON "PrintJob"("pixPaymentId", "createdAt");

ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_pixChargeId_fkey" FOREIGN KEY ("pixChargeId") REFERENCES "PixCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_pixPaymentId_fkey" FOREIGN KEY ("pixPaymentId") REFERENCES "PixPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PixPayment" ADD CONSTRAINT "PixPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PixPayment" ADD CONSTRAINT "PixPayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PixPayment" ADD CONSTRAINT "PixPayment_pixChargeId_fkey" FOREIGN KEY ("pixChargeId") REFERENCES "PixCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PixPayment" ADD CONSTRAINT "PixPayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PixPayment" ADD CONSTRAINT "PixPayment_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PixRefund" ADD CONSTRAINT "PixRefund_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PixRefund" ADD CONSTRAINT "PixRefund_pixPaymentId_fkey" FOREIGN KEY ("pixPaymentId") REFERENCES "PixPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PixRefund" ADD CONSTRAINT "PixRefund_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Apenas uma entrada financeira pode existir por origem; o banco também bloqueia
-- pagamentos e reembolsos duplicados mesmo sob concorrência entre workers.
