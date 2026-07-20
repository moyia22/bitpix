import { providerConfigurationSchema, type ProviderIntegrationDto } from "@bitpix/contracts";
import { AuditOutcome, ProviderConfigurationStatus, ProviderName, prisma } from "@bitpix/database";
import type { ProviderEnvironment } from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { decryptCredential, encryptCredential, validateCredentialShape } from "../../lib/provider-credentials.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { requirePermission } from "../auth/auth.guard.js";
import { getPaymentProvider } from "./providers/provider-factory.js";
import { ProviderError } from "./providers/payment-provider.js";

function webhookUrl(): string {
  return `${env.PUBLIC_WEBHOOK_BASE_URL.replace(/\/$/, "")}/api/v1/webhooks/mercado-pago`;
}

function dto(configuration: {
  environment: ProviderEnvironment;
  status: ProviderConfigurationStatus;
  credentialMasked: string | null;
  pixExpirationMinutes: number;
  lastVerifiedAt: Date | null;
  lastVerificationError: string | null;
  webhookSecretMasked: string | null;
} | null): ProviderIntegrationDto {
  return {
    configured: Boolean(configuration?.credentialMasked),
    provider: "MERCADO_PAGO",
    providerMode: env.PAYMENT_PROVIDER_MODE,
    environment: configuration?.environment ?? "TEST",
    status: configuration?.status ?? "NOT_CONFIGURED",
    credentialMasked: configuration?.credentialMasked ?? null,
    pixExpirationMinutes: configuration?.pixExpirationMinutes ?? 30,
    lastVerifiedAt: configuration?.lastVerifiedAt?.toISOString() ?? null,
    lastVerificationError: configuration?.lastVerificationError ?? null,
    webhookUrl: webhookUrl(),
    webhookSecretConfigured: Boolean(configuration?.webhookSecretMasked || env.MERCADO_PAGO_WEBHOOK_SECRET),
  };
}

function providerStatus(error: unknown): ProviderConfigurationStatus {
  if (!(error instanceof ProviderError)) return ProviderConfigurationStatus.TEMPORARY_FAILURE;
  if (error.code === "INVALID_CREDENTIAL") return ProviderConfigurationStatus.INVALID_TOKEN;
  if (error.code === "PERMISSION_DENIED") return ProviderConfigurationStatus.PERMISSION_ERROR;
  return ProviderConfigurationStatus.TEMPORARY_FAILURE;
}

function safeProviderMessage(error: unknown): string {
  if (error instanceof ProviderError) return error.message.slice(0, 240);
  return "Não foi possível validar a integração neste momento.";
}

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/integrations/mercado-pago", { preHandler: requirePermission("integrations.read") }, async (request) => {
    const configuration = await prisma.providerConfiguration.findUnique({
      where: { companyId_provider: { companyId: request.auth!.companyId, provider: ProviderName.MERCADO_PAGO } },
    });
    return { data: dto(configuration) };
  });

  app.put("/integrations/mercado-pago", { preHandler: requirePermission("integrations.manage") }, async (request) => {
    const body = providerConfigurationSchema.parse(request.body);
    try {
      validateCredentialShape(body.accessToken, env.PAYMENT_PROVIDER_MODE);
    } catch (error) {
      throw new AppError(400, "PROVIDER_CREDENTIAL_INVALID", error instanceof Error ? error.message : "Credencial inválida.");
    }
    if (env.PAYMENT_PROVIDER_MODE === "mock" && body.environment !== "TEST") {
      throw new AppError(400, "MOCK_ENVIRONMENT_INVALID", "O modo simulado só pode usar o ambiente de teste.");
    }
    const auth = request.auth!;
    const encrypted = encryptCredential(body.accessToken);
    const encryptedWebhookSecret = body.webhookSecret ? encryptCredential(body.webhookSecret) : null;
    const before = await prisma.providerConfiguration.findUnique({
      where: { companyId_provider: { companyId: auth.companyId, provider: ProviderName.MERCADO_PAGO } },
    });
    const configuration = await prisma.$transaction(async (tx) => {
      const saved = await tx.providerConfiguration.upsert({
        where: { companyId_provider: { companyId: auth.companyId, provider: ProviderName.MERCADO_PAGO } },
        create: {
          companyId: auth.companyId,
          provider: ProviderName.MERCADO_PAGO,
          environment: body.environment,
          status: ProviderConfigurationStatus.CONFIGURING,
          credentialCiphertext: encrypted.ciphertext,
          credentialIv: encrypted.iv,
          credentialAuthTag: encrypted.authTag,
          credentialKeyVersion: encrypted.keyVersion,
          credentialMasked: encrypted.masked,
          ...(encryptedWebhookSecret ? {
            webhookSecretCiphertext: encryptedWebhookSecret.ciphertext,
            webhookSecretIv: encryptedWebhookSecret.iv,
            webhookSecretAuthTag: encryptedWebhookSecret.authTag,
            webhookSecretMasked: encryptedWebhookSecret.masked,
          } : {}),
          pixExpirationMinutes: body.pixExpirationMinutes,
          configuredByUserId: auth.userId,
          updatedByUserId: auth.userId,
          lastVerifiedAt: null,
          lastVerificationError: null,
        },
        update: {
          environment: body.environment,
          status: ProviderConfigurationStatus.CONFIGURING,
          credentialCiphertext: encrypted.ciphertext,
          credentialIv: encrypted.iv,
          credentialAuthTag: encrypted.authTag,
          credentialKeyVersion: encrypted.keyVersion,
          credentialMasked: encrypted.masked,
          ...(encryptedWebhookSecret ? {
            webhookSecretCiphertext: encryptedWebhookSecret.ciphertext,
            webhookSecretIv: encryptedWebhookSecret.iv,
            webhookSecretAuthTag: encryptedWebhookSecret.authTag,
            webhookSecretMasked: encryptedWebhookSecret.masked,
          } : {}),
          pixExpirationMinutes: body.pixExpirationMinutes,
          updatedByUserId: auth.userId,
          lastVerifiedAt: null,
          lastVerificationError: null,
        },
      });
      await writeAudit({
        request,
        client: tx,
        action: before ? "integration.mercado_pago.updated" : "integration.mercado_pago.created",
        entity: "ProviderConfiguration",
        entityPublicId: saved.publicId,
        ...(before ? { before: { status: before.status, environment: before.environment, credentialMasked: before.credentialMasked, pixExpirationMinutes: before.pixExpirationMinutes } } : {}),
        after: { status: saved.status, environment: saved.environment, credentialMasked: saved.credentialMasked, pixExpirationMinutes: saved.pixExpirationMinutes, providerMode: env.PAYMENT_PROVIDER_MODE },
      });
      return saved;
    });
    return { data: dto(configuration) };
  });

  app.post("/integrations/mercado-pago/test", { preHandler: requirePermission("integrations.manage") }, async (request) => {
    const auth = request.auth!;
    const configuration = await prisma.providerConfiguration.findUnique({
      where: { companyId_provider: { companyId: auth.companyId, provider: ProviderName.MERCADO_PAGO } },
    });
    if (!configuration?.credentialCiphertext) throw new AppError(409, "PROVIDER_NOT_CONFIGURED", "Salve o Access Token antes de testar a conexão.");
    try {
      const result = await getPaymentProvider().testConnection(decryptCredential(configuration));
      const status = env.PAYMENT_PROVIDER_MODE === "real" && !configuration.webhookSecretMasked && !env.MERCADO_PAGO_WEBHOOK_SECRET
        ? ProviderConfigurationStatus.WEBHOOK_MISSING
        : ProviderConfigurationStatus.OPERATIONAL;
      const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.providerConfiguration.update({
          where: { id: configuration.id },
          data: { status, lastVerifiedAt: new Date(), lastVerificationError: null, updatedByUserId: auth.userId },
        });
        await writeAudit({ request, client: tx, action: "integration.mercado_pago.connection_tested", entity: "ProviderConfiguration", entityPublicId: saved.publicId, after: { status, accountId: result.accountId, providerMode: env.PAYMENT_PROVIDER_MODE } });
        return saved;
      });
      return { data: { ...dto(updated), account: result } };
    } catch (error) {
      const status = providerStatus(error);
      const message = safeProviderMessage(error);
      await prisma.$transaction(async (tx) => {
        await tx.providerConfiguration.update({ where: { id: configuration.id }, data: { status, lastVerifiedAt: new Date(), lastVerificationError: message, updatedByUserId: auth.userId } });
        await writeAudit({ request, client: tx, action: "integration.mercado_pago.connection_failed", entity: "ProviderConfiguration", entityPublicId: configuration.publicId, outcome: AuditOutcome.FAILURE, metadata: { status, providerMode: env.PAYMENT_PROVIDER_MODE } });
      });
      throw new AppError(error instanceof ProviderError && error.code === "INVALID_CREDENTIAL" ? 401 : 502, "PROVIDER_CONNECTION_FAILED", message);
    }
  });

  app.delete("/integrations/mercado-pago", { preHandler: requirePermission("integrations.manage") }, async (request) => {
    const auth = request.auth!;
    const configuration = await prisma.providerConfiguration.findUnique({ where: { companyId_provider: { companyId: auth.companyId, provider: ProviderName.MERCADO_PAGO } } });
    if (!configuration) return { data: dto(null) };
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.providerConfiguration.update({
        where: { id: configuration.id },
        data: { status: ProviderConfigurationStatus.NOT_CONFIGURED, credentialCiphertext: null, credentialIv: null, credentialAuthTag: null, credentialMasked: null, webhookSecretCiphertext: null, webhookSecretIv: null, webhookSecretAuthTag: null, webhookSecretMasked: null, lastVerifiedAt: null, lastVerificationError: null, updatedByUserId: auth.userId },
      });
      await writeAudit({ request, client: tx, action: "integration.mercado_pago.credential_removed", entity: "ProviderConfiguration", entityPublicId: saved.publicId, before: { status: configuration.status, credentialMasked: configuration.credentialMasked }, after: { status: saved.status, credentialMasked: null } });
      return saved;
    });
    return { data: dto(updated) };
  });
}
