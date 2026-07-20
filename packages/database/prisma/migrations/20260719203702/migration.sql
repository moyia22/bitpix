-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('OPENING_BALANCE', 'SUPPLY', 'WITHDRAWAL', 'PIX_PAYMENT', 'PIX_REFUND', 'ADJUSTMENT', 'CLOSING_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CashMovementDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "CashMovementSourceType" AS ENUM ('MANUAL', 'PAYMENT', 'SYSTEM');

-- AlterTable
ALTER TABLE "CashRegister" ADD COLUMN     "description" VARCHAR(240);

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "closedByUserId" TEXT,
ADD COLUMN     "closingNote" VARCHAR(500),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "discrepancy" DECIMAL(18,2),
ADD COLUMN     "expectedBalance" DECIMAL(18,2),
ADD COLUMN     "openingNote" VARCHAR(500),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "publicId" UUID NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "direction" "CashMovementDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" VARCHAR(160) NOT NULL,
    "note" VARCHAR(500),
    "sourceType" "CashMovementSourceType" NOT NULL,
    "sourceId" VARCHAR(120),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_publicId_key" ON "CashMovement"("publicId");

-- CreateIndex
CREATE INDEX "CashMovement_companyId_createdAt_idx" ON "CashMovement"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CashMovement_branchId_createdAt_idx" ON "CashMovement"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "CashMovement_cashSessionId_createdAt_idx" ON "CashMovement"("cashSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "CashMovement_createdByUserId_createdAt_idx" ON "CashMovement"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CashMovement_type_createdAt_idx" ON "CashMovement"("type", "createdAt");

-- CreateIndex
CREATE INDEX "CashRegister_branchId_status_idx" ON "CashRegister"("branchId", "status");

-- CreateIndex
CREATE INDEX "CashRegister_createdAt_idx" ON "CashRegister"("createdAt");

-- CreateIndex
CREATE INDEX "CashSession_cashRegisterId_status_idx" ON "CashSession"("cashRegisterId", "status");

-- CreateIndex
CREATE INDEX "CashSession_status_createdAt_idx" ON "CashSession"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
