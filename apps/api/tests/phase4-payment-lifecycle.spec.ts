import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "@bitpix/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashSessionToken } from "../src/modules/auth/auth.service.js";
import { MercadoPagoWebhookProcessor } from "../src/modules/payments/mercado-pago-webhook-processor.js";
import { setMockProviderOrderState } from "../src/modules/payments/providers/mock-payment-provider.js";

async function eventually(check: () => Promise<boolean>, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Condição assíncrona não foi atendida");
}

describe.sequential("Fase 4 — ciclo financeiro confirmado", () => {
  const suffix = randomUUID().slice(0, 8);
  const companyIds: string[] = [];
  const token = `phase4-${randomUUID()}`;
  const cookie = `${process.env.SESSION_COOKIE_NAME ?? "bitpix_session"}=${token}`;
  const credential = `TEST-MOCK-${randomUUID()}`;
  const webhookSecret = `phase4-secret-${randomUUID()}`;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let companyId = "";
  let cashSessionId = "";
  let cashSessionPublicId = "";
  let chargePublicId = "";
  let providerOrderId = "";

  beforeAll(async () => {
    app = await buildApp(); await app.ready();
    const company = await prisma.company.create({ data: { legalName: `Phase 4 ${suffix} Ltda`, displayName: "Loja Fase 4", slug: `phase4-${suffix}` } });
    companyId = company.id; companyIds.push(company.id);
    await prisma.companySetting.create({ data: { companyId: company.id, pixPayerEmail: "pix@teste.com.br" } });
    const branch = await prisma.branch.create({ data: { companyId, code: "MATRIZ", name: "Matriz" } });
    const role = await prisma.role.create({ data: { companyId, key: "ADMIN_TEST", name: "Administrador de teste" } });
    const keys = ["integrations.read", "integrations.manage", "pix.charge.create", "pix.charge.read", "pix.charge.cancel", "pix.charge.copy", "pix.charge.print", "pix.payment.read", "pix.charge.reconcile", "pix.webhook.read", "pix.webhook.reprocess", "pix.refund.create", "pix.refund.read", "pix.payment.receipt.print", "cash.session.read", "cash.session.close", "cash.session.close.with_pending_charges"] as const;
    for (const key of keys) {
      const permission = await prisma.permission.upsert({ where: { key }, create: { key, name: key, description: key }, update: {} });
      await prisma.rolePermission.create({ data: { companyId, roleId: role.id, permissionId: permission.id } });
    }
    const user = await prisma.user.create({ data: { companyId, branchId: branch.id, name: "Operador Fase 4", email: `phase4-${suffix}@test.local`, normalizedEmail: `phase4-${suffix}@test.local`, passwordHash: "not-used" } });
    await prisma.userRole.create({ data: { companyId, userId: user.id, roleId: role.id } });
    await prisma.userSession.create({ data: { companyId, userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) } });
    const register = await prisma.cashRegister.create({ data: { companyId, branchId: branch.id, code: "CX-04", name: "Caixa Fase 4" } });
    const session = await prisma.cashSession.create({ data: { companyId, branchId: branch.id, cashRegisterId: register.id, operatorId: user.id, openingBalance: 0 } });
    cashSessionId = session.id; cashSessionPublicId = session.publicId;
    const configured = await app.inject({ method: "PUT", url: "/api/v1/integrations/mercado-pago", headers: { cookie }, payload: { accessToken: credential, webhookSecret, environment: "TEST", pixExpirationMinutes: 30 } });
    expect(configured.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/integrations/mercado-pago/test", headers: { cookie } })).statusCode).toBe(200);
  });

  afterAll(async () => {
    for (const id of companyIds) {
      await prisma.printJob.deleteMany({ where: { companyId: id } });
      await prisma.cashMovement.deleteMany({ where: { companyId: id } });
      await prisma.pixRefund.deleteMany({ where: { companyId: id } });
      await prisma.pixPayment.deleteMany({ where: { companyId: id } });
      await prisma.webhookEvent.deleteMany({ where: { companyId: id } });
      await prisma.webhookAttempt.deleteMany({ where: { pixCharge: { companyId: id } } });
      await prisma.pixChargeStatusHistory.deleteMany({ where: { companyId: id } });
      await prisma.pixCharge.deleteMany({ where: { companyId: id } });
      await prisma.sale.deleteMany({ where: { companyId: id } });
      await prisma.notification.deleteMany({ where: { companyId: id } });
      await prisma.providerConfiguration.deleteMany({ where: { companyId: id } });
      await prisma.auditLog.deleteMany({ where: { companyId: id } });
      await prisma.cashSession.deleteMany({ where: { companyId: id } });
      await prisma.cashRegister.deleteMany({ where: { companyId: id } });
      await prisma.userSession.deleteMany({ where: { companyId: id } });
      await prisma.userRole.deleteMany({ where: { companyId: id } });
      await prisma.rolePermission.deleteMany({ where: { companyId: id } });
      await prisma.role.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.branch.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } });
    }
    await app.close();
  });

  it("cria cobrança pendente sem movimentar o caixa", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/pix/charges", headers: { cookie }, payload: { code: `F4-${suffix}`, amountInCents: 4321 } });
    expect(response.statusCode).toBe(200);
    chargePublicId = response.json().data.publicId;
    const charge = await prisma.pixCharge.findUniqueOrThrow({ where: { publicId: chargePublicId } });
    providerOrderId = charge.providerOrderId!;
    expect(await prisma.cashMovement.count({ where: { companyId, type: "PIX_PAYMENT" } })).toBe(0);
  });

  it("rejeita assinatura inválida e não produz efeito financeiro", async () => {
    const payload = { id: `invalid-${suffix}`, type: "order", data: { id: providerOrderId } };
    const response = await app.inject({ method: "POST", url: `/api/v1/webhooks/mercado-pago?data.id=${encodeURIComponent(providerOrderId)}`, headers: { "x-request-id": `invalid-${suffix}`, "x-signature": `ts=${Math.floor(Date.now() / 1_000)},v1=${"0".repeat(64)}` }, payload });
    expect(response.statusCode).toBe(401);
    expect(await prisma.pixPayment.count({ where: { companyId } })).toBe(0);
  });

  it("confirma somente após consulta ao provider e é financeiramente idempotente", async () => {
    setMockProviderOrderState(providerOrderId, { status: "paid", statusDetail: "accredited", paidAt: new Date() });
    const eventId = `paid-${suffix}`;
    const requestId = `request-${suffix}`;
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const signature = createHmac("sha256", webhookSecret).update(`id:${providerOrderId.toLowerCase()};request-id:${requestId};ts:${timestamp};`).digest("hex");
    const payload = { id: eventId, type: "order", action: "order.updated", data: { id: providerOrderId } };
    const headers = { "x-request-id": requestId, "x-signature": `ts=${timestamp},v1=${signature}` };
    const first = await app.inject({ method: "POST", url: `/api/v1/webhooks/mercado-pago?data.id=${encodeURIComponent(providerOrderId)}`, headers, payload });
    expect(first.statusCode).toBe(200);
    await eventually(async () => (await prisma.pixPayment.count({ where: { companyId } })) === 1);
    const duplicate = await app.inject({ method: "POST", url: `/api/v1/webhooks/mercado-pago?data.id=${encodeURIComponent(providerOrderId)}`, headers, payload });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().duplicate).toBe(true);
    expect(await prisma.pixPayment.count({ where: { companyId } })).toBe(1);
    expect(await prisma.cashMovement.count({ where: { companyId, type: "PIX_PAYMENT" } })).toBe(1);
    const charge = await prisma.pixCharge.findUniqueOrThrow({ where: { publicId: chargePublicId }, include: { sale: true } });
    expect(charge.status).toBe("PAID"); expect(charge.sale.status).toBe("PAID");
  });

  it("não deixa evento antigo rebaixar uma cobrança paga", async () => {
    setMockProviderOrderState(providerOrderId, { status: "waiting_payment", statusDetail: "pending", providerUpdatedAt: new Date(Date.now() - 60_000) });
    const response = await app.inject({ method: "POST", url: `/api/v1/pix/charges/${chargePublicId}/reconcile`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect((await prisma.pixCharge.findUniqueOrThrow({ where: { publicId: chargePublicId } })).status).toBe("PAID");
  });

  it("imprime comprovante completo e só movimenta reembolso confirmado", async () => {
    const payment = await prisma.pixPayment.findFirstOrThrow({ where: { companyId } });
    const receipt = await app.inject({ method: "POST", url: `/api/v1/pix/payments/${payment.publicId}/receipt`, headers: { cookie }, payload: { paperWidth: "MM80" } });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json().data.receipt).toMatchObject({ saleCode: `F4-${suffix}`, paymentMethod: "Pix", disclaimer: "Documento não fiscal" });
    expect(await prisma.cashMovement.count({ where: { companyId, type: "PIX_REFUND" } })).toBe(0);
    setMockProviderOrderState(providerOrderId, { status: "paid", statusDetail: "accredited" });
    const refund = await app.inject({ method: "POST", url: `/api/v1/pix/payments/${payment.publicId}/refunds`, headers: { cookie }, payload: { reason: "Solicitação administrativa de teste" } });
    expect(refund.statusCode).toBe(200);
    expect(await prisma.cashMovement.count({ where: { companyId, type: "PIX_REFUND" } })).toBe(1);
  });

  it("bloqueia fechamento com cobrança pendente e permite após expiração", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/pix/charges", headers: { cookie }, payload: { code: `PENDING-${suffix}`, amountInCents: 1000 } });
    expect(created.statusCode).toBe(200);
    const pending = await prisma.pixCharge.findUniqueOrThrow({ where: { publicId: created.json().data.publicId } });
    const blocked = await app.inject({ method: "POST", url: `/api/v1/cash-sessions/${cashSessionPublicId}/close`, headers: { cookie }, payload: { countedBalanceInCents: 0, confirmed: true, allowPendingCharges: false } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("CASH_SESSION_HAS_PENDING_CHARGES");
    setMockProviderOrderState(pending.providerOrderId!, { status: "expired", statusDetail: "expired" });
    expect((await app.inject({ method: "POST", url: `/api/v1/pix/charges/${pending.publicId}/reconcile`, headers: { cookie } })).statusCode).toBe(200);
    const closed = await app.inject({ method: "POST", url: `/api/v1/cash-sessions/${cashSessionPublicId}/close`, headers: { cookie }, payload: { countedBalanceInCents: 0, confirmed: true, allowPendingCharges: false } });
    expect(closed.statusCode).toBe(200);
    expect((await prisma.cashSession.findUniqueOrThrow({ where: { id: cashSessionId } })).status).toBe("CLOSED");
  });

  it("mantém pagamento tardio na sessão original e registra ajuste pós-fechamento", async () => {
    const previous = await prisma.cashSession.findUniqueOrThrow({ where: { id: cashSessionId } });
    const lateSession = await prisma.cashSession.create({ data: { companyId, branchId: previous.branchId, cashRegisterId: previous.cashRegisterId, operatorId: previous.operatorId, openingBalance: 0 } });
    cashSessionId = lateSession.id; cashSessionPublicId = lateSession.publicId;
    const created = await app.inject({ method: "POST", url: "/api/v1/pix/charges", headers: { cookie }, payload: { code: `LATE-${suffix}`, amountInCents: 2345 } });
    expect(created.statusCode).toBe(200);
    const lateCharge = await prisma.pixCharge.findUniqueOrThrow({ where: { publicId: created.json().data.publicId } });
    const closed = await app.inject({ method: "POST", url: `/api/v1/cash-sessions/${lateSession.publicId}/close`, headers: { cookie }, payload: { countedBalanceInCents: 0, confirmed: true, allowPendingCharges: true } });
    expect(closed.statusCode).toBe(200);
    setMockProviderOrderState(lateCharge.providerOrderId!, { status: "paid", statusDetail: "accredited", paidAt: new Date() });
    expect((await app.inject({ method: "POST", url: `/api/v1/pix/charges/${lateCharge.publicId}/reconcile`, headers: { cookie } })).statusCode).toBe(200);
    const adjusted = await prisma.cashSession.findUniqueOrThrow({ where: { id: lateSession.id } });
    expect(adjusted.status).toBe("CLOSED");
    expect(adjusted.closedWithPendingCharges).toBe(true);
    expect(adjusted.hasPostCloseAdjustment).toBe(true);
    expect(adjusted.expectedBalance?.toFixed(2)).toBe("23.45");
    expect(await prisma.cashMovement.count({ where: { cashSessionId: lateSession.id, type: "PIX_PAYMENT" } })).toBe(1);
  });

  it("isola valor divergente e exige análise sem crédito no caixa", async () => {
    const previous = await prisma.cashSession.findUniqueOrThrow({ where: { id: cashSessionId } });
    const mismatchSession = await prisma.cashSession.create({ data: { companyId, branchId: previous.branchId, cashRegisterId: previous.cashRegisterId, operatorId: previous.operatorId, openingBalance: 0 } });
    cashSessionId = mismatchSession.id; cashSessionPublicId = mismatchSession.publicId;
    const created = await app.inject({ method: "POST", url: "/api/v1/pix/charges", headers: { cookie }, payload: { code: `MISMATCH-${suffix}`, amountInCents: 999 } });
    const mismatch = await prisma.pixCharge.findUniqueOrThrow({ where: { publicId: created.json().data.publicId } });
    setMockProviderOrderState(mismatch.providerOrderId!, { status: "paid", amount: "10.00", paidAt: new Date() });
    expect((await app.inject({ method: "POST", url: `/api/v1/pix/charges/${mismatch.publicId}/reconcile`, headers: { cookie } })).statusCode).toBe(200);
    expect((await prisma.pixCharge.findUniqueOrThrow({ where: { id: mismatch.id } })).status).toBe("VALUE_MISMATCH");
    expect(await prisma.cashMovement.count({ where: { cashSessionId: mismatchSession.id, type: "PIX_PAYMENT" } })).toBe(0);
    expect(await prisma.notification.count({ where: { companyId, type: "PAYMENT_VALUE_MISMATCH" } })).toBe(1);
  });

  it("publica evento seguro e isolado ao reconciliar", async () => {
    const events: Array<{ companyId: string; status: string }> = [];
    const charge = await prisma.pixCharge.findUniqueOrThrow({ where: { publicId: chargePublicId } });
    const processor = new MercadoPagoWebhookProcessor({ publish: async (event) => { events.push({ companyId: event.companyId, status: event.status }); } });
    await processor.reconcileCharge(charge.publicId, companyId, randomUUID(), (await prisma.sale.findUniqueOrThrow({ where: { id: charge.saleId } })).operatorId);
    expect(events.every((event) => event.companyId === companyId)).toBe(true);
  });
});
