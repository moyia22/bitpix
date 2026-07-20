import { randomUUID } from "node:crypto";
import { pixChargeHistoryQuerySchema, pixRefundCreateSchema, printPixChargeSchema } from "@bitpix/contracts";
import {
  AuditOutcome,
  PixRefundStatus,
  PrintJobStatus,
  PrintJobType,
  WebhookEventStatus,
  prisma,
} from "@bitpix/database";
import type { Prisma } from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { decryptCredential } from "../../lib/provider-credentials.js";
import { requirePermission } from "../auth/auth.guard.js";
import { moneyFromCents } from "../cash/cash.service.js";
import { MercadoPagoWebhookProcessor } from "./mercado-pago-webhook-processor.js";
import { pixChargeDto, pixChargeInclude } from "./pix-charge.service.js";
import { getPaymentProvider } from "./providers/provider-factory.js";
import { ensureRealtimeSubscriber, subscribeToCharge } from "./realtime.js";
import { enqueueWebhook } from "./webhook-queue.js";
import { incrementPaymentMetric } from "./payment-metrics.js";

function mask(value: string | null): string | null {
  if (!value) return null;
  return value.length <= 8 ? "••••" : `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const sseConnections = new Map<string, number>();
const paginationQuerySchema = pixChargeHistoryQuerySchema.pick({ page: true, pageSize: true });

export async function paymentOperationsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/pix/charges", { preHandler: requirePermission("pix.charge.read") }, async (request) => {
    const query = pixChargeHistoryQuerySchema.parse(request.query);
    const companyId = request.auth!.companyId;
    const where: Prisma.PixChargeWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
      ...(query.search ? { OR: [
        ...(isUuid(query.search) ? [{ publicId: query.search }] : []),
        { externalReference: { contains: query.search, mode: "insensitive" } },
        { providerPaymentId: { contains: query.search, mode: "insensitive" } },
        { sale: { saleCode: { contains: query.search, mode: "insensitive" } } },
      ] } : {}),
    };
    const [charges, total] = await Promise.all([
      prisma.pixCharge.findMany({ where, include: { sale: { include: { operator: { select: { name: true } } } }, cashSession: { include: { cashRegister: { select: { name: true } } } }, payment: { select: { publicId: true } } }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.pixCharge.count({ where }),
    ]);
    return { data: charges.map((charge) => ({ publicId: charge.publicId, saleCode: charge.sale.saleCode, amount: charge.amount.toFixed(2), status: charge.status, operator: charge.sale.operator.name, cashRegister: charge.cashSession.cashRegister.name, createdAt: charge.createdAt.toISOString(), providerPaymentIdMasked: mask(charge.providerPaymentId), paidAt: charge.paidAt?.toISOString() ?? null, canPrintReceipt: Boolean(charge.payment) })), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  });

  app.get<{ Params: { publicId: string } }>("/pix/payments/:publicId", { preHandler: requirePermission("pix.payment.read") }, async (request) => {
    const payment = await prisma.pixPayment.findFirst({
      where: { publicId: request.params.publicId, companyId: request.auth!.companyId },
      include: { pixCharge: { include: { sale: { select: { saleCode: true } }, cashSession: { include: { cashRegister: { select: { code: true, name: true } } } } } }, refunds: { orderBy: { createdAt: "desc" } } },
    });
    if (!payment) throw new AppError(404, "PIX_PAYMENT_NOT_FOUND", "Pagamento Pix não encontrado.");
    return { data: {
      publicId: payment.publicId,
      chargePublicId: payment.pixCharge.publicId,
      saleCode: payment.pixCharge.sale.saleCode,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      status: payment.status,
      paidAt: payment.paidAt.toISOString(),
      providerPaymentIdMasked: mask(payment.providerPaymentId),
      providerOrderIdMasked: mask(payment.providerOrderId),
      cashRegister: payment.pixCharge.cashSession.cashRegister,
      refunds: payment.refunds.map((refund) => ({ publicId: refund.publicId, amount: refund.amount.toFixed(2), status: refund.status, requestedAt: refund.requestedAt.toISOString(), processedAt: refund.processedAt?.toISOString() ?? null })),
    } };
  });

  app.get<{ Params: { publicId: string } }>("/pix/charges/:publicId/details", { preHandler: requirePermission("pix.charge.read") }, async (request) => {
    const charge = await prisma.pixCharge.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId }, include: { sale: { include: { operator: { select: { publicId: true, name: true } } } }, cashSession: { include: { cashRegister: { select: { publicId: true, code: true, name: true } } } }, statusHistory: { orderBy: { createdAt: "asc" } }, printJobs: { select: { publicId: true, type: true, paperWidth: true, status: true, createdAt: true } }, webhookEvents: { select: { publicId: true, status: true, signatureStatus: true, processingError: true, receivedAt: true, processedAt: true }, orderBy: { receivedAt: "desc" }, take: 20 }, payment: { include: { refunds: { orderBy: { createdAt: "desc" } } } } } });
    if (!charge) throw new AppError(404, "PIX_CHARGE_NOT_FOUND", "Cobrança Pix não encontrada.");
    return { data: { publicId: charge.publicId, saleCode: charge.sale.saleCode, amount: charge.amount.toFixed(2), receivedAmount: charge.receivedAmount?.toFixed(2) ?? null, status: charge.status, createdAt: charge.createdAt.toISOString(), expiresAt: charge.expiresAt.toISOString(), paidAt: charge.paidAt?.toISOString() ?? null, providerOrderIdMasked: mask(charge.providerOrderId), providerPaymentIdMasked: mask(charge.providerPaymentId), operator: charge.sale.operator, cashRegister: charge.cashSession.cashRegister, history: charge.statusHistory.map((item) => ({ status: item.status, previousStatus: item.previousStatus, source: item.source, reason: item.reason, createdAt: item.createdAt.toISOString() })), prints: charge.printJobs.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })), webhooks: charge.webhookEvents.map((item) => ({ ...item, receivedAt: item.receivedAt.toISOString(), processedAt: item.processedAt?.toISOString() ?? null })), payment: charge.payment ? { publicId: charge.payment.publicId, amount: charge.payment.amount.toFixed(2), status: charge.payment.status, paidAt: charge.payment.paidAt.toISOString(), providerPaymentIdMasked: mask(charge.payment.providerPaymentId), refunds: charge.payment.refunds.map((refund) => ({ publicId: refund.publicId, amount: refund.amount.toFixed(2), status: refund.status, requestedAt: refund.requestedAt.toISOString(), processedAt: refund.processedAt?.toISOString() ?? null })) } : null } };
  });

  app.post<{ Params: { publicId: string } }>("/pix/charges/:publicId/reconcile", { preHandler: requirePermission("pix.charge.reconcile") }, async (request) => {
    try {
      const result = await new MercadoPagoWebhookProcessor().reconcileCharge(request.params.publicId, request.auth!.companyId, request.correlationId, request.auth!.userId);
      await writeAudit({ request, action: "pix.charge.reconciled", entity: "PixCharge", entityPublicId: request.params.publicId, metadata: { outcome: result.outcome } });
      const charge = await prisma.pixCharge.findFirstOrThrow({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId }, include: pixChargeInclude });
      return { data: pixChargeDto(charge) };
    } catch (error) {
      await writeAudit({ request, action: "pix.charge.reconciliation_failed", entity: "PixCharge", entityPublicId: request.params.publicId, outcome: AuditOutcome.FAILURE, metadata: { reason: error instanceof Error ? error.message.slice(0, 120) : "unknown" } });
      throw error;
    }
  });

  app.get<{ Params: { publicId: string } }>("/pix/charges/:publicId/events", { preHandler: requirePermission("pix.charge.read") }, async (request, reply) => {
    const auth = request.auth!;
    const charge = await prisma.pixCharge.findFirst({ where: { publicId: request.params.publicId, companyId: auth.companyId }, include: pixChargeInclude });
    if (!charge) throw new AppError(404, "PIX_CHARGE_NOT_FOUND", "Cobrança Pix não encontrada.");
    const connectionKey = `${auth.sessionId}:${charge.publicId}`;
    const active = sseConnections.get(connectionKey) ?? 0;
    if (active >= env.SSE_MAX_CONNECTIONS_PER_USER) throw new AppError(429, "SSE_CONNECTION_LIMIT", "Limite de conexões em tempo real atingido.");
    if (request.headers["last-event-id"]) incrementPaymentMetric("sse_reconnections_total");
    sseConnections.set(connectionKey, active + 1);
    await ensureRealtimeSubscriber().catch(() => undefined);
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    reply.raw.write(`retry: 3000\nid: initial-${charge.updatedAt.getTime()}\nevent: charge.${charge.status.toLowerCase()}\ndata: ${JSON.stringify({ eventId: `initial-${charge.updatedAt.getTime()}`, chargePublicId: charge.publicId, saleCode: charge.sale.saleCode, status: charge.status, amount: charge.amount.toFixed(2), paidAt: charge.paidAt?.toISOString() ?? null, updatedAt: charge.updatedAt.toISOString(), message: "Estado atual da cobrança" })}\n\n`);
    const unsubscribe = subscribeToCharge(auth.companyId, charge.publicId, (event) => {
      reply.raw.write(`id: ${event.eventId}\nevent: charge.${event.status.toLowerCase()}\ndata: ${JSON.stringify({ eventId: event.eventId, chargePublicId: event.chargePublicId, saleCode: event.saleCode, status: event.status, amount: event.amount, paidAt: event.paidAt, updatedAt: event.updatedAt, message: event.message })}\n\n`);
    });
    const heartbeat = setInterval(() => reply.raw.write(`: heartbeat ${Date.now()}\n\n`), 15_000);
    request.raw.on("close", () => { clearInterval(heartbeat); unsubscribe(); sseConnections.set(connectionKey, Math.max(0, (sseConnections.get(connectionKey) ?? 1) - 1)); });
  });

  app.post<{ Params: { publicId: string } }>("/pix/payments/:publicId/receipt", { preHandler: requirePermission("pix.payment.receipt.print") }, async (request) => {
    const body = printPixChargeSchema.parse(request.body);
    const payment = await prisma.pixPayment.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId }, include: { company: { select: { displayName: true } }, pixCharge: { include: { sale: { include: { operator: { select: { name: true } } } }, cashSession: { include: { cashRegister: { select: { name: true, code: true } } } } } } } });
    if (!payment) throw new AppError(404, "PIX_PAYMENT_NOT_FOUND", "Pagamento Pix não encontrado.");
    const last = await prisma.printJob.findFirst({ where: { pixPaymentId: payment.id }, orderBy: { createdAt: "desc" } });
    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.printJob.create({ data: { companyId: payment.companyId, branchId: payment.branchId, pixChargeId: payment.pixChargeId, pixPaymentId: payment.id, userId: request.auth!.userId, type: PrintJobType.PIX_PAYMENT_RECEIPT, paperWidth: body.paperWidth, status: PrintJobStatus.CREATED, reprintOfId: last?.id ?? null } });
      await writeAudit({ request, client: tx, action: "pix.payment.receipt_printed", entity: "PrintJob", entityPublicId: created.publicId, metadata: { paymentPublicId: payment.publicId, paperWidth: body.paperWidth, reprint: Boolean(last) } });
      return created;
    });
    return { data: { printJobPublicId: job.publicId, receipt: { storeName: payment.company.displayName, title: "Pagamento confirmado", saleCode: payment.pixCharge.sale.saleCode, amount: payment.amount.toFixed(2), paidAt: payment.paidAt.toISOString(), providerPaymentIdMasked: mask(payment.providerPaymentId), operator: payment.pixCharge.sale.operator.name, cashRegister: `${payment.pixCharge.cashSession.cashRegister.code} · ${payment.pixCharge.cashSession.cashRegister.name}`, paymentMethod: "Pix", disclaimer: "Documento não fiscal" } } };
  });

  app.post<{ Params: { publicId: string } }>("/pix/payments/:publicId/refunds", { preHandler: requirePermission("pix.refund.create") }, async (request) => {
    const body = pixRefundCreateSchema.parse(request.body);
    const payment = await prisma.pixPayment.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId }, include: { pixCharge: { include: { providerConfiguration: true } } } });
    if (!payment?.providerOrderId) throw new AppError(404, "PIX_PAYMENT_NOT_FOUND", "Pagamento Pix não encontrado.");
    const amount = body.amountInCents ? moneyFromCents(body.amountInCents) : payment.amount;
    if (amount.greaterThan(payment.amount)) throw new AppError(422, "REFUND_AMOUNT_INVALID", "O reembolso não pode superar o pagamento.");
    const idempotencyKey = randomUUID();
    const refund = await prisma.$transaction(async (tx) => {
      const created = await tx.pixRefund.create({ data: { companyId: payment.companyId, pixPaymentId: payment.id, amount, status: PixRefundStatus.REQUESTED, requestedByUserId: request.auth!.userId, reason: body.reason, idempotencyKey } });
      await writeAudit({ request, client: tx, action: "pix.refund.requested", entity: "PixRefund", entityPublicId: created.publicId, metadata: { paymentPublicId: payment.publicId, amount: amount.toFixed(2) } });
      return created;
    });
    const result = await getPaymentProvider().refundPixPayment({ providerOrderId: payment.providerOrderId, ...(body.amountInCents ? { amount: amount.toFixed(2) } : {}), idempotencyKey, accessToken: decryptCredential(payment.pixCharge.providerConfiguration) });
    await prisma.pixRefund.update({ where: { id: refund.id }, data: { status: PixRefundStatus.PROCESSING, providerRefundId: result.providerRefundId, providerResponseSanitized: result.snapshot.sanitizedResponse as Prisma.InputJsonValue } });
    await new MercadoPagoWebhookProcessor().reconcileCharge(payment.pixCharge.publicId, payment.companyId, request.correlationId, request.auth!.userId);
    return { data: await prisma.pixRefund.findUniqueOrThrow({ where: { id: refund.id }, select: { publicId: true, status: true, processedAt: true } }) };
  });

  app.get<{ Params: { publicId: string } }>("/pix/refunds/:publicId", { preHandler: requirePermission("pix.refund.read") }, async (request) => {
    const refund = await prisma.pixRefund.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId }, include: { pixPayment: { select: { publicId: true, providerPaymentId: true } } } });
    if (!refund) throw new AppError(404, "PIX_REFUND_NOT_FOUND", "Reembolso Pix não encontrado.");
    return { data: { publicId: refund.publicId, paymentPublicId: refund.pixPayment.publicId, providerPaymentIdMasked: mask(refund.pixPayment.providerPaymentId), providerRefundIdMasked: mask(refund.providerRefundId), amount: refund.amount.toFixed(2), status: refund.status, reason: refund.reason, requestedAt: refund.requestedAt.toISOString(), processedAt: refund.processedAt?.toISOString() ?? null } };
  });

  app.get("/pix/webhooks", { preHandler: requirePermission("pix.webhook.read") }, async (request) => {
    const query = paginationQuerySchema.parse(request.query);
    const companyId = request.auth!.companyId;
    const [events, total] = await Promise.all([
      prisma.webhookEvent.findMany({ where: { companyId }, select: { publicId: true, externalEventId: true, status: true, signatureStatus: true, attemptCount: true, processingError: true, receivedAt: true, processedAt: true, pixCharge: { select: { publicId: true, sale: { select: { saleCode: true } } } } }, orderBy: { receivedAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.webhookEvent.count({ where: { companyId } }),
    ]);
    return { data: events.map((event) => ({ ...event, externalEventId: mask(event.externalEventId), receivedAt: event.receivedAt.toISOString(), processedAt: event.processedAt?.toISOString() ?? null })), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  });

  app.post<{ Params: { publicId: string } }>("/pix/webhooks/:publicId/reprocess", { preHandler: requirePermission("pix.webhook.reprocess") }, async (request) => {
    const event = await prisma.webhookEvent.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId, signatureValid: true }, include: { pixCharge: true } });
    if (!event?.pixCharge) throw new AppError(404, "WEBHOOK_NOT_FOUND", "Webhook não encontrado ou não autorizado.");
    const mode = await enqueueWebhook({ webhookEventPublicId: event.publicId, companyId: event.companyId!, correlationId: request.correlationId, attempt: event.attemptCount + 1 });
    if (mode === "unavailable") {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.RETRYING, processingError: null, deadLetterReason: null } });
    } else {
      await prisma.webhookEvent.updateMany({ where: { id: event.id, status: event.status }, data: { status: WebhookEventStatus.QUEUED, processingError: null, deadLetterReason: null } });
    }
    await writeAudit({ request, action: "pix.webhook.reprocessed", entity: "WebhookEvent", entityPublicId: event.publicId, metadata: { mode } });
    return { data: { mode } };
  });
}
