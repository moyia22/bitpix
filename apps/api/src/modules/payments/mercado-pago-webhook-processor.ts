import { randomUUID } from "node:crypto";
import type { PixChargeEventDto } from "@bitpix/contracts";
import {
  AuditOutcome,
  CashMovementDirection,
  CashMovementSourceType,
  CashMovementType,
  CashSessionStatus,
  NotificationType,
  PixChargeStatus,
  PixChargeStatusSource,
  PixPaymentStatus,
  PixRefundStatus,
  Prisma,
  ProviderEnvironment,
  SaleStatus,
  WebhookEventStatus,
  prisma,
} from "@bitpix/database";
import { env } from "../../config/env.js";
import { decryptCredential } from "../../lib/provider-credentials.js";
import { getPaymentProvider } from "./providers/provider-factory.js";
import { ProviderError, type PaymentProvider, type ProviderPaymentSnapshot } from "./providers/payment-provider.js";
import { toPixChargeStatus } from "./providers/status-mapper.js";
import { incrementPaymentMetric, observePaymentMetric } from "./payment-metrics.js";
import { publishChargeEvent, type ScopedChargeEvent } from "./realtime.js";

const finalStatuses = new Set<PixChargeStatus>([
  PixChargeStatus.PAID,
  PixChargeStatus.REFUNDED,
  PixChargeStatus.PARTIALLY_REFUNDED,
  PixChargeStatus.EXPIRED,
  PixChargeStatus.CANCELLED,
  PixChargeStatus.FAILED,
  PixChargeStatus.VALUE_MISMATCH,
]);
const refundChargeStatuses = new Set<PixChargeStatus>([PixChargeStatus.REFUNDED, PixChargeStatus.PARTIALLY_REFUNDED]);
const closedWithoutPaymentStatuses = new Set<PixChargeStatus>([PixChargeStatus.CANCELLED, PixChargeStatus.EXPIRED, PixChargeStatus.FAILED]);
const pendingRefundStatuses = new Set<PixRefundStatus>([PixRefundStatus.REQUESTED, PixRefundStatus.PROCESSING]);

const statusMessages: Record<PixChargeStatus, string> = {
  CREATING: "Criando cobrança",
  WAITING_PAYMENT: "Aguardando pagamento",
  PROCESSING: "Pagamento em processamento",
  PAID: "Pagamento confirmado",
  EXPIRED: "Cobrança expirada",
  CANCELLED: "Cobrança cancelada",
  REFUNDED: "Pagamento reembolsado",
  PARTIALLY_REFUNDED: "Pagamento parcialmente reembolsado",
  FAILED: "Pagamento não concluído",
  VALUE_MISMATCH: "Valor recebido divergente",
  UNDER_REVIEW: "Pagamento em análise",
};

interface ProcessorOptions {
  provider?: PaymentProvider;
  publish?: (event: ScopedChargeEvent) => Promise<void>;
}

interface ProcessIdentity {
  correlationId: string;
  providerEventId?: string;
  webhookEventId?: string;
  attemptNumber: number;
  actorUserId?: string;
  source: "WEBHOOK" | "RECONCILIATION";
}

function safeError(error: unknown): string {
  if (error instanceof ProviderError) return error.message.slice(0, 240);
  return error instanceof Error ? error.message.slice(0, 240) : "Falha desconhecida no processamento";
}

function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError ? error.retryable : true;
}

function maskedProviderId(value: string): string {
  return value.length <= 8 ? "••••" : `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function shouldApplyStatus(current: PixChargeStatus, next: PixChargeStatus, currentProviderUpdatedAt: Date | null, incomingProviderUpdatedAt: Date | null): boolean {
  if (current === next) return false;
  if (refundChargeStatuses.has(current)) return false;
  if (current === PixChargeStatus.PAID && !refundChargeStatuses.has(next)) return false;
  if (incomingProviderUpdatedAt && currentProviderUpdatedAt && incomingProviderUpdatedAt < currentProviderUpdatedAt && finalStatuses.has(current)) return false;
  if (closedWithoutPaymentStatuses.has(current) && next !== PixChargeStatus.PAID) return false;
  return true;
}

async function systemAudit(input: {
  companyId: string;
  branchId?: string | null;
  userId?: string | null;
  correlationId: string;
  action: string;
  entity: string;
  entityPublicId?: string;
  outcome?: AuditOutcome;
  metadata?: Prisma.InputJsonValue;
  client?: Prisma.TransactionClient;
}): Promise<void> {
  await (input.client ?? prisma).auditLog.create({ data: {
    companyId: input.companyId,
    branchId: input.branchId ?? null,
    userId: input.userId ?? null,
    correlationId: input.correlationId,
    action: input.action,
    entity: input.entity,
    entityPublicId: input.entityPublicId ?? null,
    outcome: input.outcome ?? AuditOutcome.SUCCESS,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  } });
}

function eventDto(charge: { publicId: string; companyId: string; amount: Prisma.Decimal; status: PixChargeStatus; paidAt: Date | null; updatedAt: Date; sale: { saleCode: string } }): ScopedChargeEvent {
  return {
    companyId: charge.companyId,
    eventId: randomUUID(),
    chargePublicId: charge.publicId,
    saleCode: charge.sale.saleCode,
    status: charge.status,
    amount: charge.amount.toFixed(2),
    paidAt: charge.paidAt?.toISOString() ?? null,
    updatedAt: charge.updatedAt.toISOString(),
    message: statusMessages[charge.status],
  } satisfies PixChargeEventDto & { companyId: string };
}

export class MercadoPagoWebhookProcessor {
  private readonly provider: PaymentProvider;
  private readonly publish: (event: ScopedChargeEvent) => Promise<void>;

  constructor(options: ProcessorOptions = {}) {
    this.provider = options.provider ?? getPaymentProvider();
    this.publish = options.publish ?? publishChargeEvent;
  }

  async processWebhook(webhookEventPublicId: string, attemptNumber = 1): Promise<{ outcome: string; chargePublicId?: string }> {
    const startedAt = Date.now();
    const event = await prisma.webhookEvent.findUnique({
      where: { publicId: webhookEventPublicId },
      include: { pixCharge: { include: { providerConfiguration: true } } },
    });
    if (!event) return { outcome: "IGNORED" };
    if (event.signatureValid !== true || event.status === WebhookEventStatus.SIGNATURE_INVALID) return { outcome: "SIGNATURE_INVALID" };
    if (event.status === WebhookEventStatus.PROCESSED) return { outcome: "ALREADY_PROCESSED", ...(event.pixCharge ? { chargePublicId: event.pixCharge.publicId } : {}) };
    if (!event.pixCharge?.providerOrderId) {
      await prisma.$transaction(async (tx) => {
        await tx.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.IGNORED, processedAt: new Date(), processingError: "Cobrança não resolvida por identificador persistido" } });
        await tx.notification.create({ data: { companyId: event.companyId ?? event.pixCharge?.companyId ?? "", type: NotificationType.WEBHOOK_UNRESOLVED, title: "Webhook não resolvido", message: "Um evento do Mercado Pago não pôde ser associado com segurança.", entityType: "WebhookEvent", entityPublicId: event.publicId } }).catch(() => undefined);
      });
      return { outcome: "UNRESOLVED" };
    }
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.PROCESSING, attemptCount: { increment: 1 } } });
    await systemAudit({ companyId: event.pixCharge.companyId, branchId: event.pixCharge.branchId, correlationId: event.correlationId, action: "pix.webhook.processing_started", entity: "WebhookEvent", entityPublicId: event.publicId, metadata: { attemptNumber } });
    try {
      const result = await this.processCharge(event.pixCharge.id, {
        correlationId: event.correlationId,
        providerEventId: event.externalEventId ?? event.publicId,
        webhookEventId: event.id,
        attemptNumber,
        source: "WEBHOOK",
      });
      await prisma.webhookAttempt.create({ data: { webhookEventId: event.id, pixChargeId: event.pixCharge.id, attemptNumber, outcome: result.outcome, message: result.message, correlationId: event.correlationId, finishedAt: new Date(), durationMs: Date.now() - startedAt } });
      await systemAudit({ companyId: event.pixCharge.companyId, branchId: event.pixCharge.branchId, correlationId: event.correlationId, action: "pix.webhook.processing_completed", entity: "WebhookEvent", entityPublicId: event.publicId, metadata: { attemptNumber, outcome: result.outcome, durationMs: Date.now() - startedAt } });
      observePaymentMetric("webhook_processing_ms", Date.now() - startedAt);
      return { outcome: result.outcome, chargePublicId: event.pixCharge.publicId };
    } catch (error) {
      const retryable = isRetryable(error);
      const terminal = !retryable || attemptNumber >= env.WEBHOOK_MAX_ATTEMPTS;
      await prisma.$transaction(async (tx) => {
        await tx.webhookAttempt.create({ data: { webhookEventId: event.id, pixChargeId: event.pixCharge!.id, attemptNumber, outcome: terminal ? "FAILED" : "RETRYING", message: safeError(error), correlationId: event.correlationId, retryable, finishedAt: new Date(), durationMs: Date.now() - startedAt } });
        await tx.webhookEvent.update({ where: { id: event.id }, data: { status: terminal ? WebhookEventStatus.DEAD_LETTER : WebhookEventStatus.RETRYING, processingError: safeError(error), nextRetryAt: terminal ? null : new Date(Date.now() + Math.min(300_000, 2 ** attemptNumber * 2_000)), deadLetterReason: terminal ? safeError(error) : null } });
        if (terminal) await tx.notification.create({ data: { companyId: event.pixCharge!.companyId, branchId: event.pixCharge!.branchId, type: NotificationType.WEBHOOK_DEAD_LETTER, title: "Webhook requer atenção", message: "O processamento financeiro excedeu as tentativas seguras.", entityType: "WebhookEvent", entityPublicId: event.publicId } });
        await systemAudit({ client: tx, companyId: event.pixCharge!.companyId, branchId: event.pixCharge!.branchId, correlationId: event.correlationId, action: terminal ? "pix.webhook.dead_letter" : "pix.webhook.retry_scheduled", entity: "WebhookEvent", entityPublicId: event.publicId, outcome: AuditOutcome.FAILURE, metadata: { attemptNumber, retryable, reason: safeError(error) } });
      });
      incrementPaymentMetric(terminal ? "webhooks_dead_letter_total" : "webhook_retries_total");
      throw error;
    }
  }

  async reconcileCharge(chargePublicId: string, companyId: string, correlationId: string, actorUserId: string): Promise<{ outcome: string; message: string }> {
    const charge = await prisma.pixCharge.findFirst({ where: { publicId: chargePublicId, companyId }, select: { id: true } });
    if (!charge) throw new Error("Cobrança não encontrada");
    return this.processCharge(charge.id, { correlationId, attemptNumber: 1, actorUserId, source: "RECONCILIATION" });
  }

  private async processCharge(chargeId: string, identity: ProcessIdentity): Promise<{ outcome: string; message: string }> {
    const charge = await prisma.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { providerConfiguration: true } });
    if (!charge.providerOrderId) throw new Error("Cobrança sem identificador do provider");
    const snapshot = await this.provider.getPixCharge({ providerOrderId: charge.providerOrderId, accessToken: decryptCredential(charge.providerConfiguration) });
    return this.applySnapshot(charge.id, snapshot, identity);
  }

  async applySnapshot(chargeId: string, snapshot: ProviderPaymentSnapshot, identity: ProcessIdentity): Promise<{ outcome: string; message: string }> {
    const persisted = await prisma.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { providerConfiguration: true } });
    const environmentMatches = snapshot.liveMode === null || (persisted.providerConfiguration.environment === ProviderEnvironment.PRODUCTION) === snapshot.liveMode;
    if (snapshot.providerOrderId !== persisted.providerOrderId || (persisted.providerPaymentId && snapshot.providerPaymentId !== persisted.providerPaymentId) || snapshot.externalReference !== persisted.externalReference || snapshot.currency !== persisted.currency || !environmentMatches) {
      await systemAudit({ companyId: persisted.companyId, branchId: persisted.branchId, correlationId: identity.correlationId, action: "pix.payment.validation_failed", entity: "PixCharge", entityPublicId: persisted.publicId, outcome: AuditOutcome.FAILURE, metadata: { orderMatches: snapshot.providerOrderId === persisted.providerOrderId, paymentMatches: !persisted.providerPaymentId || snapshot.providerPaymentId === persisted.providerPaymentId, referenceMatches: snapshot.externalReference === persisted.externalReference, currencyMatches: snapshot.currency === persisted.currency, environmentMatches } });
      throw new ProviderError("INVALID_RESPONSE", "A consulta oficial não corresponde à cobrança persistida.");
    }

    const receivedAmount = new Prisma.Decimal(snapshot.amount);
    if (!receivedAmount.equals(persisted.amount)) {
      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { sale: { select: { saleCode: true } } } });
        if (current.status !== PixChargeStatus.VALUE_MISMATCH) {
          await tx.pixCharge.update({ where: { id: chargeId }, data: { status: PixChargeStatus.VALUE_MISMATCH, expectedAmount: current.amount, receivedAmount, lastProviderCheckAt: new Date(), providerUpdatedAt: snapshot.providerUpdatedAt, providerResponseSanitized: snapshot.sanitizedResponse as Prisma.InputJsonValue, statusHistory: { create: { companyId: current.companyId, previousStatus: current.status, status: PixChargeStatus.VALUE_MISMATCH, source: identity.source === "WEBHOOK" ? PixChargeStatusSource.WEBHOOK : PixChargeStatusSource.USER, providerEventId: identity.providerEventId ?? null, userId: identity.actorUserId ?? null, reason: "Valor confirmado diverge do valor esperado" } } } });
          await tx.sale.update({ where: { id: current.saleId }, data: { status: SaleStatus.VALUE_MISMATCH } });
          await tx.notification.create({ data: { companyId: current.companyId, branchId: current.branchId, type: NotificationType.PAYMENT_VALUE_MISMATCH, title: "Valor Pix divergente", message: "A cobrança recebeu um valor diferente e exige análise administrativa.", entityType: "PixCharge", entityPublicId: current.publicId, metadata: { expectedAmount: current.amount.toFixed(2), receivedAmount: receivedAmount.toFixed(2) } } });
          await systemAudit({ client: tx, companyId: current.companyId, branchId: current.branchId, correlationId: identity.correlationId, action: "pix.payment.value_mismatch", entity: "PixCharge", entityPublicId: current.publicId, outcome: AuditOutcome.FAILURE, metadata: { expectedAmount: current.amount.toFixed(2), receivedAmount: receivedAmount.toFixed(2) } });
        }
        if (identity.webhookEventId) await tx.webhookEvent.update({ where: { id: identity.webhookEventId }, data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), processingError: null } });
        return tx.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { sale: { select: { saleCode: true } } } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      incrementPaymentMetric("payment_value_mismatch_total");
      await this.publish(eventDto(updated));
      return { outcome: "VALUE_MISMATCH", message: "Valor divergente; nenhuma movimentação financeira criada" };
    }

    const nextStatus = toPixChargeStatus(snapshot.status);
    if (nextStatus === PixChargeStatus.PAID) return this.confirmPayment(chargeId, snapshot, identity);
    if (refundChargeStatuses.has(nextStatus)) return this.confirmRefund(chargeId, snapshot, identity, nextStatus);

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { sale: { select: { saleCode: true } } } });
      if (shouldApplyStatus(current.status, nextStatus, current.providerUpdatedAt, snapshot.providerUpdatedAt)) {
        await tx.pixCharge.update({ where: { id: current.id }, data: { status: nextStatus, providerPaymentId: snapshot.providerPaymentId, receivedAmount, lastProviderCheckAt: new Date(), providerCreatedAt: snapshot.providerCreatedAt, providerUpdatedAt: snapshot.providerUpdatedAt, providerResponseSanitized: snapshot.sanitizedResponse as Prisma.InputJsonValue, statusHistory: { create: { companyId: current.companyId, previousStatus: current.status, status: nextStatus, source: identity.source === "WEBHOOK" ? PixChargeStatusSource.WEBHOOK : PixChargeStatusSource.USER, providerEventId: identity.providerEventId ?? null, userId: identity.actorUserId ?? null, reason: snapshot.statusDetail?.slice(0, 240) ?? statusMessages[nextStatus] } } } });
        const saleStatus = nextStatus === PixChargeStatus.WAITING_PAYMENT ? SaleStatus.WAITING_PAYMENT : nextStatus === PixChargeStatus.PROCESSING || nextStatus === PixChargeStatus.UNDER_REVIEW ? SaleStatus.PROCESSING : nextStatus === PixChargeStatus.EXPIRED ? SaleStatus.EXPIRED : nextStatus === PixChargeStatus.CANCELLED ? SaleStatus.CANCELED : SaleStatus.FAILED;
        await tx.sale.update({ where: { id: current.saleId }, data: { status: saleStatus } });
      }
      if (identity.webhookEventId) await tx.webhookEvent.update({ where: { id: identity.webhookEventId }, data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), processingError: null } });
      return tx.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { sale: { select: { saleCode: true } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.publish(eventDto(updated));
    return { outcome: updated.status, message: statusMessages[updated.status] };
  }

  private async confirmPayment(chargeId: string, snapshot: ProviderPaymentSnapshot, identity: ProcessIdentity): Promise<{ outcome: string; message: string }> {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { sale: { select: { saleCode: true, operatorId: true } }, cashSession: true, payment: true } });
      if (current.payment) {
        if (identity.webhookEventId) await tx.webhookEvent.update({ where: { id: identity.webhookEventId }, data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), processingError: null } });
        return tx.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { sale: { select: { saleCode: true } } } });
      }
      if (!shouldApplyStatus(current.status, PixChargeStatus.PAID, current.providerUpdatedAt, snapshot.providerUpdatedAt)) return current as never;
      const paidAt = snapshot.paidAt ?? snapshot.providerUpdatedAt ?? new Date();
      const payment = await tx.pixPayment.create({ data: { companyId: current.companyId, branchId: current.branchId, pixChargeId: current.id, saleId: current.saleId, cashSessionId: current.cashSessionId, provider: current.provider, providerPaymentId: snapshot.providerPaymentId, providerOrderId: snapshot.providerOrderId, externalReference: snapshot.externalReference, amount: current.amount, currency: current.currency, paidAt, providerCreatedAt: snapshot.providerCreatedAt, providerUpdatedAt: snapshot.providerUpdatedAt, payerDataSanitized: snapshot.payerDataSanitized as Prisma.InputJsonValue, providerResponseSanitized: snapshot.sanitizedResponse as Prisma.InputJsonValue } });
      await tx.cashMovement.create({ data: { companyId: current.companyId, branchId: current.branchId, cashSessionId: current.cashSessionId, type: CashMovementType.PIX_PAYMENT, direction: CashMovementDirection.CREDIT, amount: current.amount, reason: "Pagamento Pix confirmado", note: `Transação ${maskedProviderId(snapshot.providerPaymentId)}`, sourceType: CashMovementSourceType.PIX_PAYMENT, sourceId: payment.publicId, createdByUserId: current.sale.operatorId } });
      await tx.pixCharge.update({ where: { id: current.id }, data: { status: PixChargeStatus.PAID, paidAt, providerPaymentId: snapshot.providerPaymentId, expectedAmount: current.amount, receivedAmount: current.amount, lastProviderCheckAt: new Date(), providerCreatedAt: snapshot.providerCreatedAt, providerUpdatedAt: snapshot.providerUpdatedAt, providerResponseSanitized: snapshot.sanitizedResponse as Prisma.InputJsonValue, lastError: null, statusHistory: { create: { companyId: current.companyId, previousStatus: current.status, status: PixChargeStatus.PAID, source: identity.source === "WEBHOOK" ? PixChargeStatusSource.WEBHOOK : PixChargeStatusSource.USER, providerEventId: identity.providerEventId ?? null, userId: identity.actorUserId ?? null, reason: "Pagamento confirmado após consulta oficial" } } } });
      await tx.sale.update({ where: { id: current.saleId }, data: { status: SaleStatus.PAID } });
      if (current.cashSession.status === CashSessionStatus.CLOSED) {
        const nextExpected = (current.cashSession.expectedBalance ?? current.cashSession.openingBalance).plus(current.amount);
        await tx.cashSession.update({ where: { id: current.cashSessionId }, data: { hasPostCloseAdjustment: true, postCloseAdjustmentAt: new Date(), expectedBalance: nextExpected, discrepancy: current.cashSession.countedBalance ? current.cashSession.countedBalance.minus(nextExpected) : null } });
        await tx.notification.create({ data: { companyId: current.companyId, branchId: current.branchId, type: NotificationType.PAYMENT_AFTER_CASH_CLOSE, title: "Pagamento após fechamento", message: "Um Pix foi confirmado na sessão original já encerrada. Revise a divergência.", entityType: "PixPayment", entityPublicId: payment.publicId } });
      }
      if (identity.webhookEventId) await tx.webhookEvent.update({ where: { id: identity.webhookEventId }, data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), processingError: null } });
      await systemAudit({ client: tx, companyId: current.companyId, branchId: current.branchId, userId: identity.actorUserId ?? null, correlationId: identity.correlationId, action: "pix.payment.confirmed", entity: "PixPayment", entityPublicId: payment.publicId, metadata: { chargePublicId: current.publicId, amount: current.amount.toFixed(2), providerPaymentIdMasked: maskedProviderId(snapshot.providerPaymentId), cashSessionStatus: current.cashSession.status } });
      return tx.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { sale: { select: { saleCode: true } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    incrementPaymentMetric("payments_confirmed_total");
    await this.publish(eventDto(updated));
    return { outcome: "PAID", message: "Pagamento confirmado" };
  }

  private async confirmRefund(chargeId: string, snapshot: ProviderPaymentSnapshot, identity: ProcessIdentity, nextStatus: PixChargeStatus): Promise<{ outcome: string; message: string }> {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { sale: { select: { saleCode: true, operatorId: true } }, cashSession: true, payment: { include: { refunds: true } } } });
      if (!current.payment) throw new ProviderError("INVALID_RESPONSE", "Reembolso recebido sem pagamento confirmado.");
      const alreadyProcessed = current.payment.refunds.find((refund) => refund.status === PixRefundStatus.PROCESSED);
      if (!alreadyProcessed && nextStatus === PixChargeStatus.REFUNDED) {
        const requested = current.payment.refunds.find((refund) => pendingRefundStatuses.has(refund.status));
        const refund = requested
          ? await tx.pixRefund.update({ where: { id: requested.id }, data: { status: PixRefundStatus.PROCESSED, processedAt: new Date(), providerResponseSanitized: snapshot.sanitizedResponse as Prisma.InputJsonValue } })
          : await tx.pixRefund.create({ data: { companyId: current.companyId, pixPaymentId: current.payment.id, amount: current.payment.amount, status: PixRefundStatus.PROCESSED, requestedByUserId: current.sale.operatorId, reason: "Reembolso confirmado pelo provedor", idempotencyKey: randomUUID(), processedAt: new Date(), providerResponseSanitized: snapshot.sanitizedResponse as Prisma.InputJsonValue } });
        await tx.cashMovement.create({ data: { companyId: current.companyId, branchId: current.branchId, cashSessionId: current.cashSessionId, type: CashMovementType.PIX_REFUND, direction: CashMovementDirection.DEBIT, amount: refund.amount, reason: "Reembolso Pix confirmado", note: "Confirmação consultada no provedor", sourceType: CashMovementSourceType.PIX_REFUND, sourceId: refund.publicId, createdByUserId: current.sale.operatorId } });
        await tx.pixPayment.update({ where: { id: current.payment.id }, data: { status: PixPaymentStatus.REFUNDED } });
        if (current.cashSession.status === CashSessionStatus.CLOSED) {
          const nextExpected = (current.cashSession.expectedBalance ?? current.cashSession.openingBalance).minus(refund.amount);
          await tx.cashSession.update({ where: { id: current.cashSessionId }, data: { hasPostCloseAdjustment: true, postCloseAdjustmentAt: new Date(), expectedBalance: nextExpected, discrepancy: current.cashSession.countedBalance ? current.cashSession.countedBalance.minus(nextExpected) : null } });
        }
      }
      await tx.pixCharge.update({ where: { id: current.id }, data: { status: nextStatus, providerUpdatedAt: snapshot.providerUpdatedAt, providerResponseSanitized: snapshot.sanitizedResponse as Prisma.InputJsonValue, statusHistory: { create: { companyId: current.companyId, previousStatus: current.status, status: nextStatus, source: identity.source === "WEBHOOK" ? PixChargeStatusSource.WEBHOOK : PixChargeStatusSource.USER, providerEventId: identity.providerEventId ?? null, userId: identity.actorUserId ?? null, reason: "Reembolso confirmado após consulta oficial" } } } });
      await tx.sale.update({ where: { id: current.saleId }, data: { status: nextStatus === PixChargeStatus.REFUNDED ? SaleStatus.REFUNDED : SaleStatus.PARTIALLY_REFUNDED } });
      if (identity.webhookEventId) await tx.webhookEvent.update({ where: { id: identity.webhookEventId }, data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), processingError: null } });
      await systemAudit({ client: tx, companyId: current.companyId, branchId: current.branchId, correlationId: identity.correlationId, action: "pix.refund.confirmed", entity: "PixPayment", entityPublicId: current.payment.publicId, metadata: { status: nextStatus } });
      return tx.pixCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { sale: { select: { saleCode: true } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.publish(eventDto(updated));
    return { outcome: nextStatus, message: statusMessages[nextStatus] };
  }
}
