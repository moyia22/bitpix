import type { CashSessionDto, CashTotalsDto } from "@bitpix/contracts";
import {
  AuditOutcome,
  Prisma,
  prisma,
  type CashMovementType,
} from "@bitpix/database";
import type { FastifyRequest } from "fastify";
import { writeAudit } from "../../lib/audit.js";
import { calculateCashTotals, type CashAmountGroup, type CashTotals } from "./cash.calculations.js";

export const cashRegisterSelect = {
  publicId: true,
  code: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  branch: { select: { publicId: true, code: true, name: true } },
  owner: { select: { publicId: true, name: true } },
} as const;

export const cashSessionInclude = {
  cashRegister: { select: { publicId: true, code: true, name: true } },
  branch: { select: { publicId: true, code: true, name: true } },
  operator: { select: { publicId: true, name: true } },
  closedBy: { select: { publicId: true, name: true } },
} as const;

type DatabaseClient = typeof prisma | Prisma.TransactionClient;
type CashSessionWithRelations = Prisma.CashSessionGetPayload<{ include: typeof cashSessionInclude }>;

export const moneyFromCents = (value: number) => new Prisma.Decimal(value).div(100);
export const moneyToString = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);

export function accessibleBranchWhere(branchId: string | null): { branchId?: string } {
  return branchId ? { branchId } : {};
}

export async function getCashTotals(
  client: DatabaseClient,
  cashSessionId: string,
  openingBalance: Prisma.Decimal,
): Promise<CashTotals> {
  const grouped = await client.cashMovement.groupBy({
    by: ["type", "direction"],
    where: { cashSessionId },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const groups: CashAmountGroup[] = grouped.map((group) => ({
    type: group.type,
    direction: group.direction,
    amount: group._sum.amount ?? new Prisma.Decimal(0),
    count: group._count._all,
  }));
  return calculateCashTotals(openingBalance, groups);
}

export function serializeCashTotals(totals: CashTotals): CashTotalsDto {
  return {
    openingBalance: moneyToString(totals.openingBalance),
    supplies: moneyToString(totals.supplies),
    withdrawals: moneyToString(totals.withdrawals),
    confirmedPix: moneyToString(totals.confirmedPix),
    refunds: moneyToString(totals.refunds),
    positiveAdjustments: moneyToString(totals.positiveAdjustments),
    negativeAdjustments: moneyToString(totals.negativeAdjustments),
    adjustments: moneyToString(totals.adjustments),
    expectedBalance: moneyToString(totals.expectedBalance),
    operationCount: totals.operationCount,
  };
}

export async function serializeCashSession(
  session: CashSessionWithRelations,
  client: DatabaseClient = prisma,
): Promise<CashSessionDto> {
  const totals = await getCashTotals(client, session.id, session.openingBalance);
  const pendingChargeCount = await client.pixCharge.count({ where: { cashSessionId: session.id, status: { in: ["CREATING", "WAITING_PAYMENT", "PROCESSING", "UNDER_REVIEW"] } } });
  return {
    publicId: session.publicId,
    status: session.status,
    openedAt: session.openedAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
    openingNote: session.openingNote,
    closingNote: session.closingNote,
    expectedBalance: session.expectedBalance ? moneyToString(session.expectedBalance) : null,
    countedBalance: session.countedBalance ? moneyToString(session.countedBalance) : null,
    discrepancy: session.discrepancy ? moneyToString(session.discrepancy) : null,
    cashRegister: session.cashRegister,
    branch: session.branch,
    operator: session.operator,
    closedBy: session.closedBy,
    totals: serializeCashTotals(totals),
    closedWithPendingCharges: session.closedWithPendingCharges,
    hasPostCloseAdjustment: session.hasPostCloseAdjustment,
    pendingChargeCount,
  };
}

export async function auditScopedAccessDenied(
  request: FastifyRequest,
  entity: "CashRegister" | "CashSession",
  requestedPublicId: string,
): Promise<void> {
  const exists = entity === "CashRegister"
    ? await prisma.cashRegister.findUnique({ where: { publicId: requestedPublicId }, select: { id: true } })
    : await prisma.cashSession.findUnique({ where: { publicId: requestedPublicId }, select: { id: true } });
  if (!exists) return;
  await writeAudit({
    request,
    action: "tenant.access.denied",
    entity,
    entityPublicId: requestedPublicId,
    outcome: AuditOutcome.FAILURE,
    metadata: { reason: "resource_outside_authenticated_scope" },
  });
}

export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function uniqueConstraintTarget(error: unknown): string[] {
  if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    if (Array.isArray(target)) return target.map(String);
    if (typeof target === "string") return [target];
  }
  return [];
}

export function movementLabel(type: CashMovementType): string {
  const labels: Record<CashMovementType, string> = {
    OPENING_BALANCE: "Saldo inicial",
    SUPPLY: "Suprimento",
    WITHDRAWAL: "Sangria",
    PIX_PAYMENT: "Pagamento Pix",
    PIX_REFUND: "Devolução Pix",
    ADJUSTMENT: "Ajuste",
    CLOSING_ADJUSTMENT: "Ajuste de fechamento",
  };
  return labels[type];
}
