import type { DashboardSummaryDto } from "@bitpix/contracts";
import { PixChargeStatus, Prisma, prisma } from "@bitpix/database";
import { AppError } from "../../lib/errors.js";

export interface AnalyticsFilters {
  preset: "today" | "yesterday" | "7d" | "30d" | "current_month" | "previous_month" | "custom";
  from?: string | undefined; to?: string | undefined; branchPublicId?: string | undefined; operatorPublicId?: string | undefined; cashRegisterPublicId?: string | undefined;
}

const dayFormatter = (timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
function dayKey(date: Date, timezone: string): string { return dayFormatter(timezone).format(date); }
function addDays(key: string, days: number): string { const date = new Date(`${key}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function startOfMonth(key: string): string { return `${key.slice(0, 7)}-01`; }
function zonedBoundary(key: string, timezone: string, end = false): Date {
  const [year, month, day] = key.split("-").map(Number);
  const guess = Date.UTC(year!, month! - 1, day!, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second), end ? 999 : 0);
  return new Date(guess - (represented - guess));
}

export function analyticsPeriod(filters: AnalyticsFilters, timezone: string) {
  const today = dayKey(new Date(), timezone);
  let fromKey: string; let toKey: string; let label: string;
  if (filters.preset === "today") { fromKey = today; toKey = today; label = "Hoje"; }
  else if (filters.preset === "yesterday") { fromKey = addDays(today, -1); toKey = fromKey; label = "Ontem"; }
  else if (filters.preset === "30d") { fromKey = addDays(today, -29); toKey = today; label = "Últimos 30 dias"; }
  else if (filters.preset === "current_month") { fromKey = startOfMonth(today); toKey = today; label = "Mês atual"; }
  else if (filters.preset === "previous_month") { const priorEnd = addDays(startOfMonth(today), -1); fromKey = startOfMonth(priorEnd); toKey = priorEnd; label = "Mês anterior"; }
  else if (filters.preset === "custom") { fromKey = filters.from!; toKey = filters.to!; label = "Período personalizado"; }
  else { fromKey = addDays(today, -6); toKey = today; label = "Últimos 7 dias"; }
  if (fromKey > toKey || (new Date(`${toKey}T00:00:00Z`).getTime() - new Date(`${fromKey}T00:00:00Z`).getTime()) / 86_400_000 > 366) throw new AppError(400, "PERIOD_INVALID", "O período informado é inválido ou excede 366 dias.");
  const from = zonedBoundary(fromKey, timezone); const to = zonedBoundary(toKey, timezone, true);
  const days = Math.round((new Date(`${toKey}T00:00:00Z`).getTime() - new Date(`${fromKey}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  const previousToKey = addDays(fromKey, -1); const previousFromKey = addDays(previousToKey, -(days - 1));
  return { from, to, fromKey, toKey, previousFrom: zonedBoundary(previousFromKey, timezone), previousTo: zonedBoundary(previousToKey, timezone, true), label };
}

async function scopedIds(companyId: string, filters: AnalyticsFilters) {
  const [branch, operator, register] = await Promise.all([
    filters.branchPublicId ? prisma.branch.findFirst({ where: { companyId, publicId: filters.branchPublicId }, select: { id: true } }) : null,
    filters.operatorPublicId ? prisma.user.findFirst({ where: { companyId, publicId: filters.operatorPublicId }, select: { id: true } }) : null,
    filters.cashRegisterPublicId ? prisma.cashRegister.findFirst({ where: { companyId, publicId: filters.cashRegisterPublicId }, select: { id: true } }) : null,
  ]);
  if ((filters.branchPublicId && !branch) || (filters.operatorPublicId && !operator) || (filters.cashRegisterPublicId && !register)) throw new AppError(400, "FILTER_INVALID", "Um dos filtros não pertence à empresa autenticada.");
  return { branchId: branch?.id, operatorId: operator?.id, cashRegisterId: register?.id };
}

function sum(values: Array<Prisma.Decimal>): Prisma.Decimal { return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0)); }

export async function dashboardSummary(companyId: string, filters: AnalyticsFilters): Promise<DashboardSummaryDto> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
  const timezone = company.timezone; const period = analyticsPeriod(filters, timezone); const ids = await scopedIds(companyId, filters);
  const paymentWhere: Prisma.PixPaymentWhereInput = { companyId, paidAt: { gte: period.from, lte: period.to }, ...(ids.branchId ? { branchId: ids.branchId } : {}), ...(ids.operatorId ? { sale: { operatorId: ids.operatorId } } : {}), ...(ids.cashRegisterId ? { cashSession: { cashRegisterId: ids.cashRegisterId } } : {}) };
  const chargeWhere: Prisma.PixChargeWhereInput = { companyId, createdAt: { gte: period.from, lte: period.to }, ...(ids.branchId ? { branchId: ids.branchId } : {}), ...(ids.operatorId ? { sale: { operatorId: ids.operatorId } } : {}), ...(ids.cashRegisterId ? { cashSession: { cashRegisterId: ids.cashRegisterId } } : {}) };
  const previousWhere: Prisma.PixPaymentWhereInput = { ...paymentWhere, paidAt: { gte: period.previousFrom, lte: period.previousTo } };
  const monthStart = zonedBoundary(startOfMonth(dayKey(new Date(), timezone)), timezone);
  const [payments, previousPayments, charges, refunds, monthPayments, openCashRegisters] = await Promise.all([
    prisma.pixPayment.findMany({ where: paymentWhere, select: { publicId: true, amount: true, paidAt: true, status: true, pixCharge: { select: { publicId: true, createdAt: true, sale: { select: { saleCode: true, operator: { select: { publicId: true, name: true } } } } } }, branch: { select: { publicId: true, name: true } } }, orderBy: { paidAt: "desc" }, take: 5_000 }),
    prisma.pixPayment.findMany({ where: previousWhere, select: { amount: true } }),
    prisma.pixCharge.findMany({ where: chargeWhere, select: { status: true } }),
    prisma.pixRefund.findMany({ where: { companyId, status: "PROCESSED", processedAt: { gte: period.from, lte: period.to } }, select: { amount: true } }),
    prisma.pixPayment.findMany({ where: { companyId, paidAt: { gte: monthStart } }, select: { amount: true } }),
    prisma.cashSession.count({ where: { companyId, status: "OPEN", ...(ids.branchId ? { branchId: ids.branchId } : {}), ...(ids.cashRegisterId ? { cashRegisterId: ids.cashRegisterId } : {}) } }),
  ]);
  const received = sum(payments.map((item) => item.amount)); const previousReceived = sum(previousPayments.map((item) => item.amount));
  const variation = previousReceived.isZero() ? null : received.minus(previousReceived).div(previousReceived).times(100).toDecimalPlaces(1).toNumber();
  const dayMap = new Map<string, { amount: Prisma.Decimal; count: number }>(); const hourMap = new Map<number, { amount: Prisma.Decimal; count: number }>();
  const operators = new Map<string, { publicId: string; name: string; amount: Prisma.Decimal; count: number }>(); const branches = new Map<string, { publicId: string; name: string; amount: Prisma.Decimal; count: number }>();
  let paymentSeconds = 0;
  for (const payment of payments) {
    const day = dayKey(payment.paidAt, timezone); const currentDay = dayMap.get(day) ?? { amount: new Prisma.Decimal(0), count: 0 }; currentDay.amount = currentDay.amount.plus(payment.amount); currentDay.count += 1; dayMap.set(day, currentDay);
    const hour = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(payment.paidAt)); const currentHour = hourMap.get(hour) ?? { amount: new Prisma.Decimal(0), count: 0 }; currentHour.amount = currentHour.amount.plus(payment.amount); currentHour.count += 1; hourMap.set(hour, currentHour);
    const op = payment.pixCharge.sale.operator; const opValue = operators.get(op.publicId) ?? { ...op, amount: new Prisma.Decimal(0), count: 0 }; opValue.amount = opValue.amount.plus(payment.amount); opValue.count += 1; operators.set(op.publicId, opValue);
    const branchValue = branches.get(payment.branch.publicId) ?? { ...payment.branch, amount: new Prisma.Decimal(0), count: 0 }; branchValue.amount = branchValue.amount.plus(payment.amount); branchValue.count += 1; branches.set(payment.branch.publicId, branchValue);
    paymentSeconds += Math.max(0, (payment.paidAt.getTime() - payment.pixCharge.createdAt.getTime()) / 1_000);
  }
  const statusCounts = new Map<PixChargeStatus, number>(); charges.forEach((charge) => statusCounts.set(charge.status, (statusCounts.get(charge.status) ?? 0) + 1));
  const pending = [PixChargeStatus.CREATING, PixChargeStatus.WAITING_PAYMENT, PixChargeStatus.PROCESSING, PixChargeStatus.UNDER_REVIEW].reduce((total, status) => total + (statusCounts.get(status) ?? 0), 0);
  const confirmedCount = payments.length; const conversionDenominator = charges.length;
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString(), timezone, label: period.label },
    primary: { received: received.toFixed(2), confirmedPayments: confirmedCount, averageTicket: confirmedCount ? received.div(confirmedCount).toFixed(2) : "0.00", pendingCharges: pending, previousReceived: previousReceived.toFixed(2), receivedVariationPercent: variation, trend: variation === null || variation === 0 ? "NEUTRAL" : variation > 0 ? "UP" : "DOWN" },
    secondary: { monthReceived: sum(monthPayments.map((item) => item.amount)).toFixed(2), expiredCharges: statusCounts.get(PixChargeStatus.EXPIRED) ?? 0, cancelledCharges: statusCounts.get(PixChargeStatus.CANCELLED) ?? 0, refunds: sum(refunds.map((item) => item.amount)).toFixed(2), conversionRate: conversionDenominator ? Number(((confirmedCount / conversionDenominator) * 100).toFixed(1)) : null, averagePaymentSeconds: confirmedCount ? Math.round(paymentSeconds / confirmedCount) : null, valueMismatches: statusCounts.get(PixChargeStatus.VALUE_MISMATCH) ?? 0, openCashRegisters },
    charts: { revenueByDay: [...dayMap].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, amount: value.amount.toFixed(2), count: value.count })), revenueByHour: [...hourMap].sort(([a], [b]) => a - b).map(([hour, value]) => ({ hour, amount: value.amount.toFixed(2), count: value.count })), statusDistribution: [...statusCounts].map(([status, count]) => ({ status, count })), operators: [...operators.values()].sort((a, b) => b.amount.comparedTo(a.amount)).slice(0, 8).map((item) => ({ ...item, amount: item.amount.toFixed(2) })), branches: [...branches.values()].sort((a, b) => b.amount.comparedTo(a.amount)).map((item) => ({ ...item, amount: item.amount.toFixed(2) })) },
    recentPayments: payments.slice(0, 8).map((payment) => ({ publicId: payment.publicId, chargePublicId: payment.pixCharge.publicId, saleCode: payment.pixCharge.sale.saleCode, amount: payment.amount.toFixed(2), status: payment.status, operator: payment.pixCharge.sale.operator.name, branch: payment.branch.name, paidAt: payment.paidAt.toISOString() })),
  };
}
