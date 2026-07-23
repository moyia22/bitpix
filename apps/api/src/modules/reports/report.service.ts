import type { z } from "zod";
import type { reportFilterSchema } from "@bitpix/contracts";
import { Prisma, prisma } from "@bitpix/database";
import { AppError } from "../../lib/errors.js";
import { analyticsPeriod } from "../dashboard/analytics.service.js";

export type ReportFilters = z.infer<typeof reportFilterSchema>;
export type ReportType = "SALES" | "PAYMENTS" | "CHARGES" | "CASH_SESSIONS" | "CASH_MOVEMENTS" | "RECONCILIATION" | "AUDIT" | "CLOSING";
export type ReportRow = Record<string, string | number | null>;

async function context(companyId: string, filters: ReportFilters) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
  const period = analyticsPeriod(filters.from && filters.to ? { preset: "custom", from: filters.from, to: filters.to } : { preset: "30d" }, company.timezone);
  const [branch, operator, register, session] = await Promise.all([
    filters.branchPublicId ? prisma.branch.findFirst({ where: { companyId, publicId: filters.branchPublicId }, select: { id: true } }) : null,
    filters.operatorPublicId ? prisma.user.findFirst({ where: { companyId, publicId: filters.operatorPublicId }, select: { id: true } }) : null,
    filters.cashRegisterPublicId ? prisma.cashRegister.findFirst({ where: { companyId, publicId: filters.cashRegisterPublicId }, select: { id: true } }) : null,
    filters.cashSessionPublicId ? prisma.cashSession.findFirst({ where: { companyId, publicId: filters.cashSessionPublicId }, select: { id: true } }) : null,
  ]);
  if ((filters.branchPublicId && !branch) || (filters.operatorPublicId && !operator) || (filters.cashRegisterPublicId && !register) || (filters.cashSessionPublicId && !session)) throw new AppError(400, "FILTER_INVALID", "Um dos filtros não pertence à empresa autenticada.");
  const min = filters.minAmountInCents === undefined ? undefined : new Prisma.Decimal(filters.minAmountInCents).div(100); const max = filters.maxAmountInCents === undefined ? undefined : new Prisma.Decimal(filters.maxAmountInCents).div(100);
  return { period, timezone: company.timezone, branchId: branch?.id, operatorId: operator?.id, registerId: register?.id, sessionId: session?.id, amount: min || max ? { ...(min ? { gte: min } : {}), ...(max ? { lte: max } : {}) } : undefined };
}

function page<T>(rows: T[], filters: ReportFilters) { const total = rows.length; const start = (filters.page - 1) * filters.pageSize; return { data: rows.slice(start, start + filters.pageSize), pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } }; }

export async function reportRows(companyId: string, type: ReportType, filters: ReportFilters, exportLimit?: number): Promise<{ rows: ReportRow[]; total: number; timezone: string }> {
  const ctx = await context(companyId, filters); const take = exportLimit ?? Math.min(filters.pageSize, 50); const skip = exportLimit ? 0 : (filters.page - 1) * filters.pageSize;
  if (type === "SALES") {
    const where: Prisma.SaleWhereInput = { companyId, createdAt: { gte: ctx.period.from, lte: ctx.period.to }, ...(filters.status ? { status: filters.status as never } : {}), ...(ctx.branchId ? { branchId: ctx.branchId } : {}), ...(ctx.operatorId ? { operatorId: ctx.operatorId } : {}), ...(ctx.sessionId ? { cashSessionId: ctx.sessionId } : {}), ...(ctx.amount ? { amount: ctx.amount } : {}), ...(filters.search ? { saleCode: { contains: filters.search, mode: "insensitive" } } : {}) };
    const [items, total] = await Promise.all([prisma.sale.findMany({ where, include: { operator: { select: { name: true } }, branch: { select: { name: true } }, pixCharges: { select: { publicId: true, providerPaymentId: true }, orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, skip, take }), prisma.sale.count({ where })]);
    return { total, timezone: ctx.timezone, rows: items.map((item) => ({ codigo: item.saleCode, valor: item.amount.toFixed(2), status: item.status, operador: item.operator.name, filial: item.branch.name, cobrancaId: item.pixCharges[0]?.publicId ?? null, mercadoPagoId: mask(item.pixCharges[0]?.providerPaymentId), data: item.createdAt.toISOString() })) };
  }
  if (type === "PAYMENTS") {
    const where: Prisma.PixPaymentWhereInput = { companyId, paidAt: { gte: ctx.period.from, lte: ctx.period.to }, ...(filters.status ? { status: filters.status as never } : {}), ...(ctx.branchId ? { branchId: ctx.branchId } : {}), ...(ctx.operatorId ? { sale: { operatorId: ctx.operatorId } } : {}), ...(ctx.sessionId ? { cashSessionId: ctx.sessionId } : {}), ...(ctx.registerId ? { cashSession: { cashRegisterId: ctx.registerId } } : {}), ...(ctx.amount ? { amount: ctx.amount } : {}), ...(filters.search ? { OR: [{ externalReference: { contains: filters.search, mode: "insensitive" } }, { providerPaymentId: { contains: filters.search, mode: "insensitive" } }] } : {}) };
    const [items, total] = await Promise.all([prisma.pixPayment.findMany({ where, include: { sale: { include: { operator: { select: { name: true } } } }, branch: { select: { name: true } }, pixCharge: { select: { publicId: true } } }, orderBy: { paidAt: "desc" }, skip, take }), prisma.pixPayment.count({ where })]);
    return { total, timezone: ctx.timezone, rows: items.map((item) => ({ pagamentoId: item.publicId, cobrancaId: item.pixCharge.publicId, codigo: item.sale.saleCode, valor: item.amount.toFixed(2), status: item.status, operador: item.sale.operator.name, filial: item.branch.name, mercadoPagoId: mask(item.providerPaymentId), pagoEm: item.paidAt.toISOString() })) };
  }
  if (type === "CHARGES") {
    const where: Prisma.PixChargeWhereInput = { companyId, createdAt: { gte: ctx.period.from, lte: ctx.period.to }, ...(filters.status ? { status: filters.status as never } : {}), ...(ctx.branchId ? { branchId: ctx.branchId } : {}), ...(ctx.operatorId ? { sale: { operatorId: ctx.operatorId } } : {}), ...(ctx.sessionId ? { cashSessionId: ctx.sessionId } : {}), ...(ctx.registerId ? { cashSession: { cashRegisterId: ctx.registerId } } : {}), ...(ctx.amount ? { amount: ctx.amount } : {}), ...(filters.search ? { OR: [...(isUuid(filters.search) ? [{ publicId: filters.search }] : []), { externalReference: { contains: filters.search, mode: "insensitive" } }, { providerPaymentId: { contains: filters.search, mode: "insensitive" } }, { sale: { saleCode: { contains: filters.search, mode: "insensitive" } } }] } : {}) };
    const [items, total] = await Promise.all([prisma.pixCharge.findMany({ where, include: { sale: { include: { operator: { select: { name: true } } } }, branch: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip, take }), prisma.pixCharge.count({ where })]);
    return { total, timezone: ctx.timezone, rows: items.map((item) => ({ cobrancaId: item.publicId, codigo: item.sale.saleCode, valor: item.amount.toFixed(2), recebido: item.receivedAmount?.toFixed(2) ?? null, status: item.status, operador: item.sale.operator.name, filial: item.branch.name, mercadoPagoId: mask(item.providerPaymentId), criadaEm: item.createdAt.toISOString(), pagaEm: item.paidAt?.toISOString() ?? null })) };
  }
  if (type === "CASH_SESSIONS") {
    const where: Prisma.CashSessionWhereInput = { companyId, openedAt: { gte: ctx.period.from, lte: ctx.period.to }, ...(filters.status ? { status: filters.status as never } : {}), ...(ctx.branchId ? { branchId: ctx.branchId } : {}), ...(ctx.operatorId ? { operatorId: ctx.operatorId } : {}), ...(ctx.registerId ? { cashRegisterId: ctx.registerId } : {}), ...(ctx.sessionId ? { id: ctx.sessionId } : {}) };
    const [items, total] = await Promise.all([prisma.cashSession.findMany({ where, include: { operator: { select: { name: true } }, branch: { select: { name: true } }, cashRegister: { select: { code: true, name: true } } }, orderBy: { openedAt: "desc" }, skip, take }), prisma.cashSession.count({ where })]);
    return { total, timezone: ctx.timezone, rows: items.map((item) => ({ sessaoId: item.publicId, status: item.status, operador: item.operator.name, filial: item.branch.name, caixa: `${item.cashRegister.code} - ${item.cashRegister.name}`, abertura: item.openingBalance.toFixed(2), esperado: item.expectedBalance?.toFixed(2) ?? null, contado: item.countedBalance?.toFixed(2) ?? null, divergencia: item.discrepancy?.toFixed(2) ?? null, abertaEm: item.openedAt.toISOString(), fechadaEm: item.closedAt?.toISOString() ?? null })) };
  }
  if (type === "CASH_MOVEMENTS") {
    const where: Prisma.CashMovementWhereInput = { companyId, createdAt: { gte: ctx.period.from, lte: ctx.period.to }, ...(filters.movementType ? { type: filters.movementType as never } : {}), ...(ctx.branchId ? { branchId: ctx.branchId } : {}), ...(ctx.operatorId ? { createdByUserId: ctx.operatorId } : {}), ...(ctx.sessionId ? { cashSessionId: ctx.sessionId } : {}), ...(ctx.registerId ? { cashSession: { cashRegisterId: ctx.registerId } } : {}), ...(ctx.amount ? { amount: ctx.amount } : {}) };
    const [items, total] = await Promise.all([prisma.cashMovement.findMany({ where, include: { createdBy: { select: { name: true } }, branch: { select: { name: true } }, cashSession: { include: { cashRegister: { select: { code: true } } } } }, orderBy: { createdAt: "desc" }, skip, take }), prisma.cashMovement.count({ where })]);
    return { total, timezone: ctx.timezone, rows: items.map((item) => ({ movimentoId: item.publicId, tipo: item.type, direcao: item.direction, valor: item.amount.toFixed(2), motivo: item.reason, operador: item.createdBy.name, filial: item.branch.name, caixa: item.cashSession.cashRegister.code, origem: item.sourceType, data: item.createdAt.toISOString() })) };
  }
  if (type === "AUDIT") {
    const where: Prisma.AuditLogWhereInput = { companyId, createdAt: { gte: ctx.period.from, lte: ctx.period.to }, ...(ctx.branchId ? { branchId: ctx.branchId } : {}), ...(ctx.operatorId ? { userId: ctx.operatorId } : {}), ...(filters.search ? { OR: [{ action: { contains: filters.search, mode: "insensitive" } }, { entity: { contains: filters.search, mode: "insensitive" } }] } : {}) };
    const [items, total] = await Promise.all([prisma.auditLog.findMany({ where, include: { actor: { select: { name: true } }, branch: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip, take }), prisma.auditLog.count({ where })]);
    return { total, timezone: ctx.timezone, rows: items.map((item) => ({ auditoriaId: item.publicId, acao: item.action, entidade: item.entity, resultado: item.outcome, usuario: item.actor?.name ?? "Sistema", filial: item.branch?.name ?? null, correlationId: item.correlationId, data: item.createdAt.toISOString() })) };
  }
  if (type === "CLOSING") {
    const rows = await closingRows(companyId, ctx);
    return { total: rows.length, timezone: ctx.timezone, rows: exportLimit ? rows.slice(0, exportLimit) : page(rows, filters).data };
  }
  const issues = await reconciliationRows(companyId, ctx.period.from, ctx.period.to);
  return { total: issues.length, timezone: ctx.timezone, rows: exportLimit ? issues.slice(0, exportLimit) : page(issues, filters).data };
}

// Fechamento consolidado por atendente: para o período, soma o Pix recebido e os
// estornos confirmados de cada operador, mais os caixas ainda abertos. É o "Z"
// que o admin usa para lançar no sistema oficial da empresa.
async function closingRows(companyId: string, ctx: Awaited<ReturnType<typeof context>>): Promise<ReportRow[]> {
  const [payments, refunds, openSessions] = await Promise.all([
    prisma.pixPayment.findMany({ where: { companyId, paidAt: { gte: ctx.period.from, lte: ctx.period.to }, ...(ctx.operatorId ? { sale: { operatorId: ctx.operatorId } } : {}), ...(ctx.branchId ? { branchId: ctx.branchId } : {}) }, select: { amount: true, sale: { select: { operator: { select: { publicId: true, name: true } } } } } }),
    prisma.pixRefund.findMany({ where: { companyId, status: "PROCESSED", processedAt: { gte: ctx.period.from, lte: ctx.period.to }, ...(ctx.operatorId ? { pixPayment: { sale: { operatorId: ctx.operatorId } } } : {}) }, select: { amount: true, pixPayment: { select: { sale: { select: { operator: { select: { publicId: true, name: true } } } } } } } }),
    prisma.cashSession.findMany({ where: { companyId, status: "OPEN", ...(ctx.operatorId ? { operatorId: ctx.operatorId } : {}), ...(ctx.branchId ? { branchId: ctx.branchId } : {}) }, select: { operator: { select: { publicId: true, name: true } } } }),
  ]);
  const acc = new Map<string, { operador: string; pagamentos: number; pixRecebido: Prisma.Decimal; estornosCount: number; estornado: Prisma.Decimal; caixasAbertos: number }>();
  const ensure = (publicId: string, name: string) => { let row = acc.get(publicId); if (!row) { row = { operador: name, pagamentos: 0, pixRecebido: new Prisma.Decimal(0), estornosCount: 0, estornado: new Prisma.Decimal(0), caixasAbertos: 0 }; acc.set(publicId, row); } return row; };
  for (const payment of payments) { const row = ensure(payment.sale.operator.publicId, payment.sale.operator.name); row.pagamentos += 1; row.pixRecebido = row.pixRecebido.plus(payment.amount); }
  for (const refund of refunds) { const op = refund.pixPayment.sale.operator; const row = ensure(op.publicId, op.name); row.estornosCount += 1; row.estornado = row.estornado.plus(refund.amount); }
  for (const session of openSessions) ensure(session.operator.publicId, session.operator.name).caixasAbertos += 1;
  return [...acc.values()]
    .map((row) => ({ operador: row.operador, pagamentos: row.pagamentos, pixRecebido: row.pixRecebido.toFixed(2), estornos: row.estornosCount, valorEstornado: row.estornado.toFixed(2), liquido: row.pixRecebido.minus(row.estornado).toFixed(2), caixasAbertos: row.caixasAbertos }))
    .sort((a, b) => Number(b.pixRecebido) - Number(a.pixRecebido));
}

export async function reconciliationRows(companyId: string, from: Date, to: Date): Promise<ReportRow[]> {
  const [payments, movements, charges, refunds, webhooks] = await Promise.all([
    prisma.pixPayment.findMany({ where: { companyId, paidAt: { gte: from, lte: to } }, include: { sale: true, pixCharge: true } }),
    prisma.cashMovement.findMany({ where: { companyId, createdAt: { gte: from, lte: to }, type: { in: ["PIX_PAYMENT", "PIX_REFUND"] } } }),
    prisma.pixCharge.findMany({ where: { companyId, createdAt: { gte: from, lte: to }, status: { in: ["PAID", "VALUE_MISMATCH"] } }, include: { sale: true, payment: true } }),
    prisma.pixRefund.findMany({ where: { companyId, processedAt: { gte: from, lte: to }, status: "PROCESSED" }, include: { pixPayment: true } }),
    prisma.webhookEvent.findMany({ where: { companyId, receivedAt: { gte: from, lte: to }, status: { in: ["FAILED", "RETRYING", "DEAD_LETTER"] } }, select: { publicId: true, status: true, processingError: true } }),
  ]);
  const movementSources = new Set(movements.map((item) => item.sourceId)); const paymentIds = new Set(payments.map((item) => item.publicId)); const issues: ReportRow[] = [];
  payments.filter((payment) => !movementSources.has(payment.publicId)).forEach((payment) => issues.push({ tipo: "PAYMENT_WITHOUT_CASH_MOVEMENT", severidade: "HIGH", entidadeId: payment.publicId, codigo: payment.sale.saleCode, valor: payment.amount.toFixed(2), mensagem: "Pagamento confirmado sem movimento de caixa" }));
  movements.filter((movement) => movement.type === "PIX_PAYMENT" && movement.sourceId && !paymentIds.has(movement.sourceId)).forEach((movement) => issues.push({ tipo: "CASH_MOVEMENT_WITHOUT_PAYMENT", severidade: "HIGH", entidadeId: movement.publicId, codigo: null, valor: movement.amount.toFixed(2), mensagem: "Movimento Pix sem pagamento associado" }));
  charges.filter((charge) => charge.status === "PAID" && (!charge.payment || charge.sale.status !== "PAID")).forEach((charge) => issues.push({ tipo: "PAID_CHARGE_INCONSISTENT", severidade: "HIGH", entidadeId: charge.publicId, codigo: charge.sale.saleCode, valor: charge.amount.toFixed(2), mensagem: "Cobrança paga com venda ou pagamento inconsistente" }));
  charges.filter((charge) => charge.status === "VALUE_MISMATCH").forEach((charge) => issues.push({ tipo: "VALUE_MISMATCH", severidade: "MEDIUM", entidadeId: charge.publicId, codigo: charge.sale.saleCode, valor: charge.receivedAmount?.toFixed(2) ?? charge.amount.toFixed(2), mensagem: "Valor confirmado diverge do esperado" }));
  refunds.filter((refund) => !movementSources.has(refund.publicId)).forEach((refund) => issues.push({ tipo: "REFUND_WITHOUT_CASH_MOVEMENT", severidade: "HIGH", entidadeId: refund.publicId, codigo: null, valor: refund.amount.toFixed(2), mensagem: "Reembolso confirmado sem movimento de saída" }));
  webhooks.forEach((event) => issues.push({ tipo: "WEBHOOK_NOT_PROCESSED", severidade: event.status === "DEAD_LETTER" ? "HIGH" : "MEDIUM", entidadeId: event.publicId, codigo: null, valor: null, mensagem: event.processingError ?? `Webhook em ${event.status}` }));
  return issues;
}

function mask(value: string | null | undefined): string | null { return value ? `${value.slice(0, 4)}••••${value.slice(-4)}` : null; }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
