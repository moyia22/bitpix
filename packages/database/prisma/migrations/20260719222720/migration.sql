-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'XLSX', 'PDF');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExportReportType" AS ENUM ('SALES', 'PAYMENTS', 'CHARGES', 'CASH_SESSIONS', 'CASH_MOVEMENTS', 'RECONCILIATION', 'AUDIT');

-- CreateEnum
CREATE TYPE "StoredFilePurpose" AS ENUM ('COMPANY_LOGO', 'REPORT_EXPORT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'EXPORT_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'EXPORT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'INTEGRATION_UNAVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE 'SUSPICIOUS_ACCESS';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_LIMIT_NEAR';
ALTER TYPE "NotificationType" ADD VALUE 'QUEUE_UNAVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE 'CASH_DISCREPANCY';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'INACTIVE';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "addressLine1" VARCHAR(180),
ADD COLUMN     "addressLine2" VARCHAR(180),
ADD COLUMN     "city" VARCHAR(100),
ADD COLUMN     "postalCode" VARCHAR(12),
ADD COLUMN     "state" CHAR(2),
ADD COLUMN     "timezone" VARCHAR(80);

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "planId" TEXT,
ADD COLUMN     "timezone" VARCHAR(80) NOT NULL DEFAULT 'America/Sao_Paulo';

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mustResetPassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "userLimit" INTEGER NOT NULL,
    "branchLimit" INTEGER NOT NULL,
    "cashRegisterLimit" INTEGER NOT NULL,
    "monthlyChargeLimit" INTEGER NOT NULL,
    "monthlyExportLimit" INTEGER NOT NULL,
    "features" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "overrideUserLimit" INTEGER,
    "overrideBranchLimit" INTEGER,
    "overrideCashLimit" INTEGER,
    "overrideChargeLimit" INTEGER,
    "overrideExportLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySetting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "defaultPixExpirationMinutes" INTEGER NOT NULL DEFAULT 30,
    "confirmBeforePix" BOOLEAN NOT NULL DEFAULT false,
    "blockDuplicateCode" BOOLEAN NOT NULL DEFAULT true,
    "codeUniquenessScope" VARCHAR(30) NOT NULL DEFAULT 'OPEN_CHARGES',
    "autoPrint" BOOLEAN NOT NULL DEFAULT false,
    "printAfterConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "autoReturnToSale" BOOLEAN NOT NULL DEFAULT false,
    "autoReturnSeconds" INTEGER NOT NULL DEFAULT 5,
    "blockCloseWithPendingCharges" BOOLEAN NOT NULL DEFAULT true,
    "minSaleAmount" DECIMAL(18,2) NOT NULL DEFAULT 0.01,
    "maxSaleAmount" DECIMAL(18,2) NOT NULL DEFAULT 999999999.99,
    "dateFormat" VARCHAR(30) NOT NULL DEFAULT 'dd/MM/yyyy',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchSetting" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "defaultPixExpirationMinutes" INTEGER,
    "autoPrint" BOOLEAN,
    "printAfterConfirmation" BOOLEAN,
    "autoReturnToSale" BOOLEAN,
    "autoReturnSeconds" INTEGER,
    "blockCloseWithPendingCharges" BOOLEAN,
    "minSaleAmount" DECIMAL(18,2),
    "maxSaleAmount" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" VARCHAR(20) NOT NULL DEFAULT 'SYSTEM',
    "paymentSoundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notificationPreferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintTemplate" (
    "id" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "scopeKey" VARCHAR(80) NOT NULL,
    "storeName" VARCHAR(120) NOT NULL,
    "title" VARCHAR(120) NOT NULL DEFAULT 'Cobrança Pix',
    "messageAboveQr" VARCHAR(240),
    "messageBelowQr" VARCHAR(240),
    "footer" VARCHAR(300),
    "paperWidth" "PrintPaperWidth" NOT NULL DEFAULT 'MM80',
    "qrSize" INTEGER NOT NULL DEFAULT 240,
    "alignment" VARCHAR(10) NOT NULL DEFAULT 'CENTER',
    "showSaleCode" BOOLEAN NOT NULL DEFAULT true,
    "showAmount" BOOLEAN NOT NULL DEFAULT true,
    "showPixCopyPaste" BOOLEAN NOT NULL DEFAULT false,
    "showDate" BOOLEAN NOT NULL DEFAULT true,
    "showTime" BOOLEAN NOT NULL DEFAULT true,
    "showExpiration" BOOLEAN NOT NULL DEFAULT true,
    "showOperator" BOOLEAN NOT NULL DEFAULT false,
    "showCashRegister" BOOLEAN NOT NULL DEFAULT false,
    "showTransactionId" BOOLEAN NOT NULL DEFAULT true,
    "showNonFiscalDisclaimer" BOOLEAN NOT NULL DEFAULT true,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "cutSpacingMm" INTEGER NOT NULL DEFAULT 8,
    "autoPrint" BOOLEAN NOT NULL DEFAULT false,
    "printAfterConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "autoReturnToSale" BOOLEAN NOT NULL DEFAULT false,
    "paymentSoundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "logoFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "companyId" TEXT NOT NULL,
    "purpose" "StoredFilePurpose" NOT NULL,
    "storageKey" VARCHAR(240) NOT NULL,
    "originalName" VARCHAR(180),
    "mimeType" VARCHAR(80) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "downloadTokenHash" CHAR(64),
    "downloadExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reportType" "ExportReportType" NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "filters" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "rowCount" INTEGER,
    "outputFileId" TEXT,
    "errorMessage" VARCHAR(240),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_publicId_key" ON "Plan"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_publicId_key" ON "Subscription"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_companyId_key" ON "Subscription"("companyId");

-- CreateIndex
CREATE INDEX "Subscription_planId_status_idx" ON "Subscription"("planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySetting_companyId_key" ON "CompanySetting"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSetting_branchId_key" ON "BranchSetting"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintTemplate_publicId_key" ON "PrintTemplate"("publicId");

-- CreateIndex
CREATE INDEX "PrintTemplate_branchId_idx" ON "PrintTemplate"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintTemplate_companyId_scopeKey_key" ON "PrintTemplate"("companyId", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_publicId_key" ON "StoredFile"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_storageKey_key" ON "StoredFile"("storageKey");

-- CreateIndex
CREATE INDEX "StoredFile_companyId_purpose_createdAt_idx" ON "StoredFile"("companyId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "StoredFile_expiresAt_idx" ON "StoredFile"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExportJob_publicId_key" ON "ExportJob"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportJob_outputFileId_key" ON "ExportJob"("outputFileId");

-- CreateIndex
CREATE INDEX "ExportJob_companyId_status_requestedAt_idx" ON "ExportJob"("companyId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "ExportJob_requestedById_requestedAt_idx" ON "ExportJob"("requestedById", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySetting" ADD CONSTRAINT "CompanySetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchSetting" ADD CONSTRAINT "BranchSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintTemplate" ADD CONSTRAINT "PrintTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintTemplate" ADD CONSTRAINT "PrintTemplate_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintTemplate" ADD CONSTRAINT "PrintTemplate_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_outputFileId_fkey" FOREIGN KEY ("outputFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
