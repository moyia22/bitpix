-- CreateEnum
CREATE TYPE "ProviderName" AS ENUM ('MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "ProviderEnvironment" AS ENUM ('TEST', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "ProviderConfigurationStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURING', 'CONNECTED', 'INVALID_TOKEN', 'REVOKED', 'TEMPORARY_FAILURE', 'PERMISSION_ERROR', 'WEBHOOK_MISSING', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "PixChargeStatus" AS ENUM ('CREATING', 'WAITING_PAYMENT', 'PROCESSING', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED', 'VALUE_MISMATCH', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "PixChargeStatusSource" AS ENUM ('USER', 'PROVIDER', 'WEBHOOK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "WebhookSignatureStatus" AS ENUM ('VALID', 'INVALID', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "PrintPaperWidth" AS ENUM ('MM58', 'MM80');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('CREATED', 'PRINTED', 'FAILED');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "description" VARCHAR(240);

-- CreateTable
CREATE TABLE "ProviderConfiguration" (
    "id" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "ProviderName" NOT NULL,
    "environment" "ProviderEnvironment" NOT NULL DEFAULT 'TEST',
    "status" "ProviderConfigurationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "credentialCiphertext" TEXT,
    "credentialIv" VARCHAR(32),
    "credentialAuthTag" VARCHAR(64),
    "credentialKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "credentialMasked" VARCHAR(80),
    "pixExpirationMinutes" INTEGER NOT NULL DEFAULT 30,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerificationError" VARCHAR(240),
    "configuredByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PixCharge" (
    "id" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "providerConfigurationId" TEXT NOT NULL,
    "provider" "ProviderName" NOT NULL,
    "providerOrderId" VARCHAR(120),
    "providerPaymentId" VARCHAR(120),
    "externalReference" VARCHAR(120) NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "status" "PixChargeStatus" NOT NULL DEFAULT 'CREATING',
    "qrCodeText" TEXT,
    "qrCodeBase64" TEXT,
    "ticketUrl" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastProviderCheckAt" TIMESTAMP(3),
    "providerResponseSanitized" JSONB,
    "lastError" VARCHAR(240),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PixChargeStatusHistory" (
    "id" TEXT NOT NULL,
    "pixChargeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "previousStatus" "PixChargeStatus",
    "status" "PixChargeStatus" NOT NULL,
    "source" "PixChargeStatusSource" NOT NULL,
    "providerEventId" VARCHAR(120),
    "userId" TEXT,
    "reason" VARCHAR(240),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PixChargeStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "companyId" TEXT,
    "provider" "ProviderName" NOT NULL,
    "externalEventId" VARCHAR(120),
    "fingerprint" CHAR(64) NOT NULL,
    "headersSanitized" JSONB NOT NULL,
    "rawBody" TEXT NOT NULL,
    "rawBodyHash" CHAR(64) NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "signatureStatus" "WebhookSignatureStatus" NOT NULL,
    "processingError" VARCHAR(240),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookAttempt" (
    "id" TEXT NOT NULL,
    "webhookEventId" TEXT NOT NULL,
    "pixChargeId" TEXT,
    "attemptNumber" INTEGER NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "message" VARCHAR(240),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "pixChargeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paperWidth" "PrintPaperWidth" NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'CREATED',
    "reprintOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedAt" TIMESTAMP(3),

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConfiguration_publicId_key" ON "ProviderConfiguration"("publicId");

-- CreateIndex
CREATE INDEX "ProviderConfiguration_companyId_status_idx" ON "ProviderConfiguration"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConfiguration_companyId_provider_key" ON "ProviderConfiguration"("companyId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "PixCharge_publicId_key" ON "PixCharge"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "PixCharge_idempotencyKey_key" ON "PixCharge"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PixCharge_companyId_status_createdAt_idx" ON "PixCharge"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PixCharge_companyId_externalReference_idx" ON "PixCharge"("companyId", "externalReference");

-- CreateIndex
CREATE INDEX "PixCharge_branchId_createdAt_idx" ON "PixCharge"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "PixCharge_saleId_idx" ON "PixCharge"("saleId");

-- CreateIndex
CREATE INDEX "PixCharge_cashSessionId_idx" ON "PixCharge"("cashSessionId");

-- CreateIndex
CREATE INDEX "PixCharge_providerOrderId_idx" ON "PixCharge"("providerOrderId");

-- CreateIndex
CREATE INDEX "PixChargeStatusHistory_companyId_createdAt_idx" ON "PixChargeStatusHistory"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "PixChargeStatusHistory_pixChargeId_createdAt_idx" ON "PixChargeStatusHistory"("pixChargeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_publicId_key" ON "WebhookEvent"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_fingerprint_key" ON "WebhookEvent"("fingerprint");

-- CreateIndex
CREATE INDEX "WebhookEvent_companyId_receivedAt_idx" ON "WebhookEvent"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_status_receivedAt_idx" ON "WebhookEvent"("provider", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_externalEventId_idx" ON "WebhookEvent"("externalEventId");

-- CreateIndex
CREATE INDEX "WebhookAttempt_pixChargeId_createdAt_idx" ON "WebhookAttempt"("pixChargeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookAttempt_webhookEventId_attemptNumber_key" ON "WebhookAttempt"("webhookEventId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_publicId_key" ON "PrintJob"("publicId");

-- CreateIndex
CREATE INDEX "PrintJob_companyId_createdAt_idx" ON "PrintJob"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_pixChargeId_createdAt_idx" ON "PrintJob"("pixChargeId", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_userId_createdAt_idx" ON "PrintJob"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProviderConfiguration" ADD CONSTRAINT "ProviderConfiguration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConfiguration" ADD CONSTRAINT "ProviderConfiguration_configuredByUserId_fkey" FOREIGN KEY ("configuredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConfiguration" ADD CONSTRAINT "ProviderConfiguration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixCharge" ADD CONSTRAINT "PixCharge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixCharge" ADD CONSTRAINT "PixCharge_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixCharge" ADD CONSTRAINT "PixCharge_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixCharge" ADD CONSTRAINT "PixCharge_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixCharge" ADD CONSTRAINT "PixCharge_providerConfigurationId_fkey" FOREIGN KEY ("providerConfigurationId") REFERENCES "ProviderConfiguration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixChargeStatusHistory" ADD CONSTRAINT "PixChargeStatusHistory_pixChargeId_fkey" FOREIGN KEY ("pixChargeId") REFERENCES "PixCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixChargeStatusHistory" ADD CONSTRAINT "PixChargeStatusHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookAttempt" ADD CONSTRAINT "WebhookAttempt_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookAttempt" ADD CONSTRAINT "WebhookAttempt_pixChargeId_fkey" FOREIGN KEY ("pixChargeId") REFERENCES "PixCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_pixChargeId_fkey" FOREIGN KEY ("pixChargeId") REFERENCES "PixCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_reprintOfId_fkey" FOREIGN KEY ("reprintOfId") REFERENCES "PrintJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariantes financeiros e operacionais que não podem depender apenas da aplicação.
ALTER TABLE "PixCharge"
  ADD CONSTRAINT "PixCharge_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "ProviderConfiguration"
  ADD CONSTRAINT "ProviderConfiguration_expiration_range" CHECK ("pixExpirationMinutes" BETWEEN 30 AND 43200);

-- Uma referência de venda não pode ter duas cobranças simultaneamente ativas
-- dentro da mesma empresa, inclusive sob concorrência entre instâncias da API.
CREATE UNIQUE INDEX "PixCharge_one_active_reference_per_company"
  ON "PixCharge" ("companyId", "externalReference")
  WHERE "status" IN ('CREATING', 'WAITING_PAYMENT', 'PROCESSING', 'UNDER_REVIEW');
