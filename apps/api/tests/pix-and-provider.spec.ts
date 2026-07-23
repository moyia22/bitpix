import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "@bitpix/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { encryptCredential, decryptCredential } from "../src/lib/provider-credentials.js";
import { hashSessionToken } from "../src/modules/auth/auth.service.js";

describe.sequential("Mercado Pago e cobranças Pix", () => {
  const suffix = randomUUID().slice(0, 8);
  const companyIds: string[] = [];
  const cookieName = process.env.SESSION_COOKIE_NAME ?? "bitpix_session";
  const tokenA = `pix-a-${randomUUID()}`;
  const tokenB = `pix-b-${randomUUID()}`;
  const cookieA = `${cookieName}=${tokenA}`;
  const cookieB = `${cookieName}=${tokenB}`;
  const mockCredential = `TEST-MOCK-${randomUUID()}`;
  const webhookSecret = `webhook-secret-${randomUUID()}`;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let chargePublicId = "";

  beforeAll(async () => {
    app = await buildApp(); await app.ready();
    for (const tenant of ["A", "B"] as const) {
      const company = await prisma.company.create({ data: { legalName: `Pix ${tenant} Ltda`, displayName: `Pix ${tenant}`, slug: `pix-${tenant.toLowerCase()}-${suffix}` } });
      companyIds.push(company.id);
      await prisma.companySetting.create({ data: { companyId: company.id, pixPayerEmail: "pix@teste.com.br" } });
      const branch = await prisma.branch.create({ data: { companyId: company.id, code: "MATRIZ", name: `Matriz ${tenant}` } });
      const role = await prisma.role.create({ data: { companyId: company.id, key: "PIX_TESTER", name: "Operador Pix" } });
      for (const key of ["integrations.read", "integrations.manage", "pix.charge.create", "pix.charge.read", "pix.charge.cancel", "pix.charge.copy", "pix.charge.print"] as const) {
        const permission = await prisma.permission.upsert({ where: { key }, create: { key, name: key, description: key }, update: {} });
        await prisma.rolePermission.create({ data: { companyId: company.id, roleId: role.id, permissionId: permission.id } });
      }
      const user = await prisma.user.create({ data: { companyId: company.id, branchId: branch.id, name: `Operador ${tenant}`, email: `pix-${tenant.toLowerCase()}-${suffix}@test.local`, normalizedEmail: `pix-${tenant.toLowerCase()}-${suffix}@test.local`, passwordHash: "not-used" } });
      await prisma.userRole.create({ data: { companyId: company.id, userId: user.id, roleId: role.id } });
      await prisma.userSession.create({ data: { companyId: company.id, userId: user.id, tokenHash: hashSessionToken(tenant === "A" ? tokenA : tokenB), expiresAt: new Date(Date.now() + 3_600_000) } });
      const register = await prisma.cashRegister.create({ data: { companyId: company.id, branchId: branch.id, code: "CX-01", name: "Caixa Pix" } });
      await prisma.cashSession.create({ data: { companyId: company.id, branchId: branch.id, cashRegisterId: register.id, operatorId: user.id, status: "OPEN", openingBalance: 0 } });
    }
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { externalEventId: `evt-${suffix}` } });
    for (const companyId of companyIds) {
      await prisma.printJob.deleteMany({ where: { companyId } });
      await prisma.webhookAttempt.deleteMany({ where: { pixCharge: { companyId } } });
      await prisma.pixChargeStatusHistory.deleteMany({ where: { companyId } });
      await prisma.pixCharge.deleteMany({ where: { companyId } });
      await prisma.sale.deleteMany({ where: { companyId } });
      await prisma.providerConfiguration.deleteMany({ where: { companyId } });
      await prisma.auditLog.deleteMany({ where: { companyId } });
      await prisma.cashMovement.deleteMany({ where: { companyId } });
      await prisma.cashSession.deleteMany({ where: { companyId } });
      await prisma.cashRegister.deleteMany({ where: { companyId } });
      await prisma.userSession.deleteMany({ where: { companyId } });
      await prisma.userRole.deleteMany({ where: { companyId } });
      await prisma.rolePermission.deleteMany({ where: { companyId } });
      await prisma.role.deleteMany({ where: { companyId } });
      await prisma.user.deleteMany({ where: { companyId } });
      await prisma.branch.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    }
    await app.close();
  });

  it("cifra e autentica a credencial sem persistir o texto puro", () => {
    const encrypted = encryptCredential(mockCredential);
    expect(encrypted.ciphertext).not.toContain(mockCredential);
    expect(encrypted.masked).not.toBe(mockCredential);
    expect(decryptCredential({ credentialCiphertext: encrypted.ciphertext, credentialIv: encrypted.iv, credentialAuthTag: encrypted.authTag })).toBe(mockCredential);
  });

  it("salva a credencial mascarada e testa o provedor simulado", async () => {
    const saved = await app.inject({ method: "PUT", url: "/api/v1/integrations/mercado-pago", headers: { cookie: cookieA }, payload: { accessToken: mockCredential, webhookSecret, environment: "TEST", pixExpirationMinutes: 30 } });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(mockCredential);
    const tested = await app.inject({ method: "POST", url: "/api/v1/integrations/mercado-pago/test", headers: { cookie: cookieA } });
    expect(tested.statusCode).toBe(200);
    expect(tested.json()).toMatchObject({ data: { status: "OPERATIONAL", providerMode: "mock" } });
  });

  it("não expõe a configuração para outra empresa", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/integrations/mercado-pago", headers: { cookie: cookieB } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { configured: false, status: "NOT_CONFIGURED" } });
  });

  it("cria Pix idempotente, sem movimentar o caixa como pagamento", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/pix/charges", headers: { cookie: cookieA }, payload: { code: `PED-${suffix}`, amountInCents: 12345 } });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ data: { saleCode: `PED-${suffix}`, amount: "123.45", status: "WAITING_PAYMENT", providerMode: "mock" } });
    expect(created.json().data.qrCodeText).toContain("BITPIX-MOCK");
    chargePublicId = created.json().data.publicId;
    const movements = await prisma.cashMovement.count({ where: { companyId: companyIds[0]!, type: "PIX_PAYMENT" } });
    expect(movements).toBe(0);
  });

  it("bloqueia cobrança duplicada e permite reabrir a existente", async () => {
    const duplicate = await app.inject({ method: "POST", url: "/api/v1/pix/charges", headers: { cookie: cookieA }, payload: { code: `PED-${suffix}`, amountInCents: 12345 } });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: "PIX_CHARGE_ALREADY_EXISTS", details: { existingChargePublicId: chargePublicId } } });
  });

  it("impede IDOR da cobrança entre empresas", async () => {
    const response = await app.inject({ method: "GET", url: `/api/v1/pix/charges/${chargePublicId}`, headers: { cookie: cookieB } });
    expect(response.statusCode).toBe(404);
  });

  it("audita cópia, impressão e cancelamento sem registrar o código Pix", async () => {
    expect((await app.inject({ method: "POST", url: `/api/v1/pix/charges/${chargePublicId}/copy`, headers: { cookie: cookieA } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/pix/charges/${chargePublicId}/print`, headers: { cookie: cookieA }, payload: { paperWidth: "MM58" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/pix/charges/${chargePublicId}/cancel`, headers: { cookie: cookieA } })).statusCode).toBe(200);
    const audits = await prisma.auditLog.findMany({ where: { companyId: companyIds[0]!, entityPublicId: chargePublicId } });
    expect(audits.map((audit) => audit.action)).toContain("pix.charge.cancelled");
    expect(JSON.stringify(audits)).not.toContain("BITPIX-MOCK|");
    expect(JSON.stringify(audits)).not.toContain(mockCredential);
  });

  it("recebe webhook assinado de forma idempotente sem confiar no corpo", async () => {
    const persisted = await prisma.pixCharge.findUniqueOrThrow({ where: { publicId: chargePublicId } });
    const dataId = persisted.providerOrderId!;
    const requestId = `req-${suffix}`;
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const signature = createHmac("sha256", webhookSecret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`).digest("hex");
    const payload = JSON.stringify({ id: `evt-${suffix}`, type: "order", data: { id: dataId } });
    const headers = { "content-type": "application/json", "x-request-id": requestId, "x-signature": `ts=${timestamp},v1=${signature}` };
    const first = await app.inject({ method: "POST", url: `/api/v1/webhooks/mercado-pago?data.id=${encodeURIComponent(dataId)}`, headers, payload });
    const duplicate = await app.inject({ method: "POST", url: `/api/v1/webhooks/mercado-pago?data.id=${encodeURIComponent(dataId)}`, headers, payload });
    expect(first.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ received: true, duplicate: true });
    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { externalEventId: `evt-${suffix}` } });
    expect(event.rawBody).toBe(payload);
    expect(event.signatureStatus).toBe("VALID");
  });
});
