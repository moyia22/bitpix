import { createHash } from "node:crypto";
import { AuditOutcome, Prisma, ProviderName, WebhookEventStatus, WebhookSignatureStatus, prisma } from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { decryptWebhookSecret } from "../../lib/provider-credentials.js";
import { writeAudit } from "../../lib/audit.js";
import { enqueueWebhook } from "./webhook-queue.js";
import { incrementPaymentMetric } from "./payment-metrics.js";
import { validateMercadoPagoSignature } from "./webhook-signature.js";

function text(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post("/webhooks/mercado-pago", {
    config: { rawBody: true, rateLimit: { max: 300, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = (request.body ?? {}) as { id?: string | number; data?: { id?: string | number }; type?: string; action?: string };
    const queryDataId = text((request.query as { "data.id"?: string })?.["data.id"]);
    const dataId = text(body.data?.id) ?? queryDataId;
    const externalEventId = text(body.id);
    if (!dataId || !externalEventId || body.type !== "order") {
      incrementPaymentMetric("webhooks_malformed_total");
      return reply.code(400).send({ received: false, error: "malformed_event" });
    }
    const rawBody = typeof request.rawBody === "string" ? request.rawBody : JSON.stringify(body);
    const rawBodyHash = createHash("sha256").update(rawBody).digest("hex");
    const requestId = text(request.headers["x-request-id"]);
    const signatureHeader = text(request.headers["x-signature"]);
    const fingerprint = createHash("sha256").update(`${externalEventId}:${requestId ?? ""}:${rawBodyHash}`).digest("hex");
    const charge = await prisma.pixCharge.findFirst({
      where: { provider: ProviderName.MERCADO_PAGO, OR: [{ providerOrderId: dataId }, { providerPaymentId: dataId }] },
      include: { providerConfiguration: true },
    });
    const configuredSecret = charge ? decryptWebhookSecret(charge.providerConfiguration) : null;
    const secret = (configuredSecret ?? env.MERCADO_PAGO_WEBHOOK_SECRET) || undefined;
    const signatureStatus = validateMercadoPagoSignature({ signatureHeader, requestId, dataId, secret, toleranceSeconds: env.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS });
    const signatureValid = signatureStatus === WebhookSignatureStatus.VALID;
    const signatureTimestamp = signatureHeader?.split(",").find((part) => part.trim().startsWith("ts="))?.trim() ?? null;
    let event;
    try {
      event = await prisma.webhookEvent.create({ data: {
        provider: ProviderName.MERCADO_PAGO,
        companyId: charge?.companyId ?? null,
        pixChargeId: charge?.id ?? null,
        externalEventId,
        requestId: requestId ?? null,
        correlationId: request.correlationId,
        fingerprint,
        headersSanitized: { contentType: request.headers["content-type"] ?? null, userAgent: request.headers["user-agent"]?.slice(0, 160) ?? null, requestId: requestId ?? null, signaturePresent: Boolean(signatureHeader), signatureTimestamp },
        rawBody,
        rawBodyHash,
        signatureStatus,
        signatureValid,
        status: signatureValid ? WebhookEventStatus.SIGNATURE_VALID : WebhookEventStatus.SIGNATURE_INVALID,
      } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        incrementPaymentMetric("webhooks_duplicate_total");
        if (charge) await writeAudit({ request, companyId: charge.companyId, branchId: charge.branchId, userId: null, action: "pix.webhook.duplicate", entity: "WebhookEvent", outcome: AuditOutcome.SUCCESS, metadata: { externalEventId } });
        return reply.code(200).send({ received: true, duplicate: true });
      }
      throw error;
    }
    incrementPaymentMetric("webhooks_received_total");
    if (charge) await writeAudit({ request, companyId: charge.companyId, branchId: charge.branchId, userId: null, action: "pix.webhook.received", entity: "WebhookEvent", entityPublicId: event.publicId, metadata: { externalEventId, signatureStatus } });
    if (!signatureValid) {
      incrementPaymentMetric("webhooks_invalid_total");
      if (charge) await writeAudit({ request, companyId: charge.companyId, branchId: charge.branchId, userId: null, action: "pix.webhook.signature_invalid", entity: "WebhookEvent", entityPublicId: event.publicId, outcome: AuditOutcome.FAILURE, metadata: { signatureStatus, externalEventId } });
      return reply.code(signatureStatus === WebhookSignatureStatus.NOT_CONFIGURED ? 503 : 401).send({ received: false, signatureStatus });
    }
    if (!charge) {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.IGNORED, processingError: "Cobrança não localizada por identificador persistido", processedAt: new Date() } });
      return reply.code(202).send({ received: true, queued: false, unresolved: true });
    }
    const mode = await enqueueWebhook({ webhookEventPublicId: event.publicId, companyId: charge.companyId, correlationId: request.correlationId, attempt: 1 });
    if (mode === "unavailable") {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.RETRYING, nextRetryAt: new Date(Date.now() + 30_000) } });
    } else {
      // O fallback local pode concluir antes desta linha; a condição evita regredir PROCESSED para QUEUED.
      await prisma.webhookEvent.updateMany({ where: { id: event.id, status: WebhookEventStatus.SIGNATURE_VALID }, data: { status: WebhookEventStatus.QUEUED, nextRetryAt: null } });
    }
    await writeAudit({ request, companyId: charge.companyId, branchId: charge.branchId, userId: null, action: "pix.webhook.queued", entity: "WebhookEvent", entityPublicId: event.publicId, metadata: { mode, externalEventId } });
    return reply.code(mode === "unavailable" ? 503 : 200).send({ received: true, queued: mode === "queue", fallback: mode === "fallback" });
  });
}
