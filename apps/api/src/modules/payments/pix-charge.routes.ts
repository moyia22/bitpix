import { randomUUID } from "node:crypto";
import { pixChargeCreateSchema, printPixChargeSchema } from "@bitpix/contracts";
import {
  AuditOutcome,
  CashSessionStatus,
  PixChargeStatus,
  PixChargeStatusSource,
  PrintJobStatus,
  ProviderConfigurationStatus,
  ProviderName,
  SaleStatus,
  prisma,
} from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { decryptCredential } from "../../lib/provider-credentials.js";
import { requirePermission } from "../auth/auth.guard.js";
import { enforceCompanyLimit } from "../platform/plan-limits.js";
import { moneyFromCents, moneyToString } from "../cash/cash.service.js";
import { pixChargeDto, pixChargeInclude } from "./pix-charge.service.js";
import { incrementPaymentMetric } from "./payment-metrics.js";
import { getPaymentProvider } from "./providers/provider-factory.js";
import { ProviderError } from "./providers/payment-provider.js";
import { toPixChargeStatus } from "./providers/status-mapper.js";

const configuredStatuses: ProviderConfigurationStatus[] = [
  ProviderConfigurationStatus.CONNECTED,
  ProviderConfigurationStatus.OPERATIONAL,
  ProviderConfigurationStatus.WEBHOOK_MISSING,
];
const duplicateStatuses: PixChargeStatus[] = [
  PixChargeStatus.CREATING,
  PixChargeStatus.WAITING_PAYMENT,
  PixChargeStatus.PROCESSING,
  PixChargeStatus.UNDER_REVIEW,
  PixChargeStatus.PAID,
  PixChargeStatus.REFUNDED,
  PixChargeStatus.PARTIALLY_REFUNDED,
];

export async function pixChargeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/pix/readiness", { preHandler: requirePermission("pix.charge.create") }, async (request) => {
    const configuration = await prisma.providerConfiguration.findUnique({
      where: { companyId_provider: { companyId: request.auth!.companyId, provider: ProviderName.MERCADO_PAGO } },
      select: { status: true, credentialMasked: true, lastVerifiedAt: true },
    });
    return {
      data: {
        configured: Boolean(configuration?.credentialMasked && configuredStatuses.includes(configuration.status)),
        status: configuration?.status ?? ProviderConfigurationStatus.NOT_CONFIGURED,
        providerMode: env.PAYMENT_PROVIDER_MODE,
        lastVerifiedAt: configuration?.lastVerifiedAt?.toISOString() ?? null,
      },
    };
  });

  app.post("/pix/charges", { preHandler: requirePermission("pix.charge.create") }, async (request) => {
    // Prova de que a rota FOI atingida (se este log não aparece, a requisição nem chegou:
    // ver os 403 de gate/permissão no auth.guard, que barram antes deste handler).
    request.log.info({ userId: request.auth?.userId, companyId: request.auth?.companyId, branchId: request.auth?.branchId }, "[PIX] POST /pix/charges — rota atingida");
    const body = pixChargeCreateSchema.parse(request.body);
    const auth = request.auth!;
    await enforceCompanyLimit(auth.companyId, "monthlyCharges");
    if (!auth.branchId) {
      request.log.warn({ userId: auth.userId }, "[PIX] bloqueado: usuário sem filial vinculada");
      throw new AppError(409, "BRANCH_REQUIRED", "Vincule o usuário a uma filial antes de cobrar.");
    }

    const [cashSession, configuration, existing] = await Promise.all([
      prisma.cashSession.findFirst({
        where: { companyId: auth.companyId, branchId: auth.branchId, operatorId: auth.userId, status: CashSessionStatus.OPEN },
        include: { cashRegister: true },
        orderBy: { openedAt: "desc" },
      }),
      prisma.providerConfiguration.findUnique({
        where: { companyId_provider: { companyId: auth.companyId, provider: ProviderName.MERCADO_PAGO } },
      }),
      prisma.pixCharge.findFirst({
        where: { companyId: auth.companyId, externalReference: body.code, status: { in: duplicateStatuses } },
        select: { publicId: true, status: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (!cashSession) {
      request.log.warn({ saleCode: body.code, userId: auth.userId }, "[PIX] bloqueado: nenhum caixa aberto para o operador");
      await writeAudit({ request, action: "pix.charge.denied.cash_closed", entity: "PixCharge", outcome: AuditOutcome.FAILURE, metadata: { saleCode: body.code } });
      throw new AppError(409, "OPEN_CASH_SESSION_REQUIRED", "Abra o caixa antes de gerar uma cobrança Pix.");
    }
    if (!configuration?.credentialCiphertext || !configuredStatuses.includes(configuration.status)) {
      request.log.warn({ saleCode: body.code, providerStatus: configuration?.status ?? "NOT_CONFIGURED" }, "[PIX] bloqueado: Mercado Pago não configurado/testado");
      await writeAudit({ request, action: "pix.charge.denied.provider_not_ready", entity: "PixCharge", outcome: AuditOutcome.FAILURE, metadata: { saleCode: body.code, providerStatus: configuration?.status ?? "NOT_CONFIGURED" } });
      throw new AppError(409, "PROVIDER_NOT_READY", "Configure e teste a integração com o Mercado Pago antes de cobrar.");
    }
    if (existing) {
      request.log.warn({ saleCode: body.code, existingStatus: existing.status }, "[PIX] bloqueado: cobrança duplicada para o mesmo código");
      await writeAudit({ request, action: "pix.charge.duplicate_blocked", entity: "PixCharge", entityPublicId: existing.publicId, outcome: AuditOutcome.FAILURE, metadata: { saleCode: body.code, existingStatus: existing.status } });
      throw new AppError(409, "PIX_CHARGE_ALREADY_EXISTS", "Este código já possui uma cobrança Pix.", { existingChargePublicId: existing.publicId, status: existing.status });
    }

    const amount = moneyFromCents(body.amountInCents);
    const idempotencyKey = randomUUID();
    const expiresAt = new Date(Date.now() + configuration.pixExpirationMinutes * 60_000);
    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const sale = await tx.sale.create({
          data: {
            companyId: auth.companyId,
            branchId: auth.branchId!,
            cashSessionId: cashSession.id,
            operatorId: auth.userId,
            saleCode: body.code,
            ...(body.description ? { description: body.description } : {}),
            amount,
            status: SaleStatus.PROCESSING,
          },
        });
        const charge = await tx.pixCharge.create({
          data: {
            companyId: auth.companyId,
            branchId: auth.branchId!,
            saleId: sale.id,
            cashSessionId: cashSession.id,
            providerConfigurationId: configuration.id,
            provider: ProviderName.MERCADO_PAGO,
            externalReference: body.code,
            idempotencyKey,
            amount,
            status: PixChargeStatus.CREATING,
            expiresAt,
            statusHistory: { create: { companyId: auth.companyId, status: PixChargeStatus.CREATING, source: PixChargeStatusSource.USER, userId: auth.userId, reason: "Solicitação de cobrança criada" } },
          },
          include: pixChargeInclude,
        });
        await writeAudit({ request, client: tx, action: "pix.charge.creation_requested", entity: "PixCharge", entityPublicId: charge.publicId, after: { saleCode: body.code, amount: moneyToString(amount), provider: "MERCADO_PAGO", providerMode: env.PAYMENT_PROVIDER_MODE, idempotencyKey } });
        return charge;
      });
    } catch (error) {
      const conflict = error as { code?: string };
      if (conflict.code === "P2002") throw new AppError(409, "PIX_CHARGE_ALREADY_EXISTS", "Este código já possui uma cobrança Pix.");
      throw error;
    }

    const startedAt = Date.now();
    request.log.info({ chargePublicId: created.publicId, saleCode: body.code, amount: moneyToString(amount), providerMode: env.PAYMENT_PROVIDER_MODE }, "[PIX] Iniciando criação");
    try {
      const provider = getPaymentProvider();
      // Payload sanitizado enviado ao MP (sem token, e-mail completo, QR ou segredo).
      request.log.info({
        chargePublicId: created.publicId,
        payload: {
          type: "online", processing_mode: "automatic", currency: "BRL",
          total_amount: moneyToString(amount),
          external_reference: body.code,
          payer_email_domain: auth.principal.user.email.split("@")[1] ?? null,
          expiration: `${configuration.pixExpirationMinutes}min`,
          payment_method: { id: "pix", type: "bank_transfer" },
          has_description: Boolean(body.description),
        },
      }, "[PIX] Enviando ao Mercado Pago");
      const providerStartedAt = Date.now();
      const result = await provider.createPixCharge({
        amount: moneyToString(amount),
        externalReference: body.code,
        ...(body.description ? { description: body.description } : {}),
        payerEmail: auth.principal.user.email,
        expirationMinutes: configuration.pixExpirationMinutes,
        idempotencyKey,
        accessToken: decryptCredential(configuration),
      });
      request.log.info({ chargePublicId: created.publicId, providerMs: Date.now() - providerStartedAt, providerStatus: result.status }, "[PIX] Mercado Pago respondeu");
      const status = toPixChargeStatus(result.status);
      request.log.info({ chargePublicId: created.publicId }, "[PIX] Salvando cobrança");
      await prisma.$transaction(async (tx) => {
        const charge = await tx.pixCharge.update({
          where: { id: created.id },
          data: {
            providerOrderId: result.providerOrderId,
            providerPaymentId: result.providerPaymentId,
            status,
            qrCodeText: result.qrCodeText,
            qrCodeBase64: result.qrCodeBase64,
            ticketUrl: result.ticketUrl,
            expiresAt: result.expiresAt,
            lastProviderCheckAt: new Date(),
            providerResponseSanitized: result.sanitizedResponse as never,
            statusHistory: { create: { companyId: auth.companyId, previousStatus: PixChargeStatus.CREATING, status, source: PixChargeStatusSource.PROVIDER, reason: "Cobrança aceita pelo provedor" } },
          },
        });
        await tx.sale.update({ where: { id: created.saleId }, data: { status: status === PixChargeStatus.WAITING_PAYMENT ? SaleStatus.WAITING_PAYMENT : SaleStatus.PROCESSING } });
        await writeAudit({ request, client: tx, action: "pix.charge.created", entity: "PixCharge", entityPublicId: charge.publicId, after: { status, amount: moneyToString(amount), saleCode: body.code, providerOrderId: result.providerOrderId, providerMode: env.PAYMENT_PROVIDER_MODE } });
        return charge.id;
      });
      const persisted = await prisma.pixCharge.findUniqueOrThrow({ where: { id: created.id }, include: pixChargeInclude });
      request.log.info({ chargePublicId: created.publicId, totalMs: Date.now() - startedAt }, "[PIX] Resposta enviada");
      return { data: pixChargeDto(persisted) };
    } catch (error) {
      const retryable = error instanceof ProviderError && error.retryable;
      const providerCode = error instanceof ProviderError ? error.code : "UNKNOWN";
      const providerDetail = error instanceof ProviderError ? error.detail : undefined;
      const providerSanitized = error instanceof ProviderError ? error.sanitized : undefined;
      const status = retryable ? PixChargeStatus.CREATING : PixChargeStatus.FAILED;
      const message = error instanceof ProviderError ? error.message : "Falha inesperada ao criar a cobrança.";
      // Log com a RESPOSTA COMPLETA sanitizada do provedor (status HTTP, request-id, cause,
      // status_detail) — antes só o motivo genérico aparecia. Sem token/cookie/QR/segredo.
      request.log.error({ chargePublicId: created.publicId, totalMs: Date.now() - startedAt, providerCode, providerDetail, providerResponse: providerSanitized, retryable, err: error }, "[PIX] Falha ao criar cobrança no Mercado Pago");
      const reason = (providerDetail ? `${message} (${providerDetail})` : message).slice(0, 240);
      await prisma.$transaction(async (tx) => {
        await tx.pixCharge.update({
          where: { id: created.id },
          data: { status, lastError: reason, statusHistory: { create: { companyId: auth.companyId, previousStatus: PixChargeStatus.CREATING, status, source: PixChargeStatusSource.PROVIDER, reason } } },
        });
        if (!retryable) await tx.sale.update({ where: { id: created.saleId }, data: { status: SaleStatus.FAILED } });
        await writeAudit({ request, client: tx, action: "pix.charge.creation_failed", entity: "PixCharge", entityPublicId: created.publicId, outcome: AuditOutcome.FAILURE, metadata: { retryable, providerMode: env.PAYMENT_PROVIDER_MODE, errorCode: providerCode, ...(providerDetail ? { providerDetail: providerDetail.slice(0, 240) } : {}) } });
      });
      throw new AppError(retryable ? 504 : 502, retryable ? "PROVIDER_TIMEOUT" : "PROVIDER_CHARGE_FAILED", message, { chargePublicId: created.publicId, retryable });
    }
  });

  app.get<{ Params: { publicId: string } }>("/pix/charges/:publicId", { preHandler: requirePermission("pix.charge.read") }, async (request) => {
    if (request.headers["x-bitpix-polling"] === "true") incrementPaymentMetric("polling_requests_total");
    const charge = await prisma.pixCharge.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId }, include: pixChargeInclude });
    if (!charge) {
      await writeAudit({ request, action: "pix.charge.read_denied", entity: "PixCharge", entityPublicId: request.params.publicId, outcome: AuditOutcome.FAILURE, metadata: { reason: "not_found_or_cross_tenant" } });
      throw new AppError(404, "PIX_CHARGE_NOT_FOUND", "Cobrança Pix não encontrada.");
    }
    return { data: pixChargeDto(charge) };
  });

  app.post<{ Params: { publicId: string } }>("/pix/charges/:publicId/cancel", { preHandler: requirePermission("pix.charge.cancel") }, async (request) => {
    const auth = request.auth!;
    const charge = await prisma.pixCharge.findFirst({ where: { publicId: request.params.publicId, companyId: auth.companyId }, include: { ...pixChargeInclude, providerConfiguration: true } });
    if (!charge) throw new AppError(404, "PIX_CHARGE_NOT_FOUND", "Cobrança Pix não encontrada.");
    const cancellable: PixChargeStatus[] = [PixChargeStatus.CREATING, PixChargeStatus.WAITING_PAYMENT, PixChargeStatus.PROCESSING];
    if (!cancellable.includes(charge.status)) throw new AppError(409, "PIX_CHARGE_NOT_CANCELLABLE", "Esta cobrança não pode mais ser cancelada.");
    if (charge.providerOrderId) {
      await getPaymentProvider().cancelPixCharge({ providerOrderId: charge.providerOrderId, idempotencyKey: randomUUID(), accessToken: decryptCredential(charge.providerConfiguration) });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.pixCharge.update({ where: { id: charge.id }, data: { status: PixChargeStatus.CANCELLED, cancelledAt: new Date(), statusHistory: { create: { companyId: auth.companyId, previousStatus: charge.status, status: PixChargeStatus.CANCELLED, source: PixChargeStatusSource.USER, userId: auth.userId, reason: "Cancelada pelo usuário" } } }, include: pixChargeInclude });
      await tx.sale.update({ where: { id: charge.saleId }, data: { status: SaleStatus.CANCELED } });
      await writeAudit({ request, client: tx, action: "pix.charge.cancelled", entity: "PixCharge", entityPublicId: charge.publicId, before: { status: charge.status }, after: { status: saved.status } });
      return saved;
    });
    return { data: pixChargeDto(updated) };
  });

  app.post<{ Params: { publicId: string } }>("/pix/charges/:publicId/copy", { preHandler: requirePermission("pix.charge.copy") }, async (request) => {
    const charge = await prisma.pixCharge.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId }, select: { id: true, publicId: true, qrCodeText: true } });
    if (!charge?.qrCodeText) throw new AppError(404, "PIX_CODE_NOT_FOUND", "Código Pix não disponível.");
    await writeAudit({ request, action: "pix.charge.code_copied", entity: "PixCharge", entityPublicId: charge.publicId, metadata: { codePresent: true } });
    return { data: { audited: true } };
  });

  app.post<{ Params: { publicId: string } }>("/pix/charges/:publicId/print", { preHandler: requirePermission("pix.charge.print") }, async (request) => {
    const body = printPixChargeSchema.parse(request.body);
    const auth = request.auth!;
    const charge = await prisma.pixCharge.findFirst({ where: { publicId: request.params.publicId, companyId: auth.companyId }, include: pixChargeInclude });
    if (!charge?.qrCodeBase64) throw new AppError(404, "PIX_CHARGE_NOT_FOUND", "Cobrança Pix não encontrada.");
    const lastPrint = await prisma.printJob.findFirst({ where: { companyId: auth.companyId, pixChargeId: charge.id }, orderBy: { createdAt: "desc" } });
    const job = await prisma.$transaction(async (tx) => {
      const saved = await tx.printJob.create({ data: { companyId: auth.companyId, branchId: charge.branchId, pixChargeId: charge.id, userId: auth.userId, paperWidth: body.paperWidth, status: PrintJobStatus.CREATED, ...(lastPrint ? { reprintOfId: lastPrint.id } : {}) } });
      await writeAudit({ request, client: tx, action: lastPrint ? "pix.charge.reprint_requested" : "pix.charge.print_requested", entity: "PrintJob", entityPublicId: saved.publicId, metadata: { pixChargePublicId: charge.publicId, paperWidth: body.paperWidth } });
      return saved;
    });
    return { data: { printJobPublicId: job.publicId, reprint: Boolean(lastPrint), charge: pixChargeDto(charge) } };
  });
}
