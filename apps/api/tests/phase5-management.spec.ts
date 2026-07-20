import { randomUUID } from "node:crypto";
import { prisma } from "@bitpix/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashSessionToken } from "../src/modules/auth/auth.service.js";
import { analyticsPeriod } from "../src/modules/dashboard/analytics.service.js";

describe.sequential("Fase 5 — gestão e isolamento", () => {
  const suffix = randomUUID().slice(0, 8); const token = `phase5-${randomUUID()}`; const cookie = `${process.env.SESSION_COOKIE_NAME ?? "bitpix_session"}=${token}`;
  let app: Awaited<ReturnType<typeof buildApp>>; let companyId = ""; let foreignCompanyId = ""; let foreignBranchPublicId = "";
  beforeAll(async () => {
    app = await buildApp(); await app.ready();
    const company = await prisma.company.create({ data: { legalName: `Gestão ${suffix} Ltda`, displayName: "Gestão Fase 5", slug: `phase5-${suffix}` } }); companyId = company.id;
    const foreign = await prisma.company.create({ data: { legalName: `Externa ${suffix} Ltda`, displayName: "Empresa externa", slug: `phase5-foreign-${suffix}` } }); foreignCompanyId = foreign.id;
    const branch = await prisma.branch.create({ data: { companyId, code: "MATRIZ", name: "Matriz" } }); const foreignBranch = await prisma.branch.create({ data: { companyId: foreign.id, code: "EXT", name: "Externa" } }); foreignBranchPublicId = foreignBranch.publicId;
    const role = await prisma.role.create({ data: { companyId, key: "MANAGER_TEST", name: "Gestor" } });
    const keys = ["dashboard.read", "dashboard.financial.read", "reports.sales.read", "reports.export", "settings.read", "settings.update", "branches.read", "branches.create", "notifications.read"];
    for (const key of keys) { const permission = await prisma.permission.upsert({ where: { key }, create: { key, name: key, description: key }, update: {} }); await prisma.rolePermission.create({ data: { companyId, roleId: role.id, permissionId: permission.id } }); }
    const user = await prisma.user.create({ data: { companyId, branchId: branch.id, name: "Gestor Fase 5", email: `phase5-${suffix}@test.local`, normalizedEmail: `phase5-${suffix}@test.local`, passwordHash: "not-used" } }); await prisma.userRole.create({ data: { companyId, userId: user.id, roleId: role.id } }); await prisma.userSession.create({ data: { companyId, userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) } });
  });
  afterAll(async () => { for (const id of [companyId, foreignCompanyId]) { await prisma.auditLog.deleteMany({ where: { companyId: id } }); await prisma.notification.deleteMany({ where: { companyId: id } }); await prisma.userSession.deleteMany({ where: { companyId: id } }); await prisma.userRole.deleteMany({ where: { companyId: id } }); await prisma.rolePermission.deleteMany({ where: { companyId: id } }); await prisma.user.deleteMany({ where: { companyId: id } }); await prisma.role.deleteMany({ where: { companyId: id } }); await prisma.branchSetting.deleteMany({ where: { branch: { companyId: id } } }); await prisma.branch.deleteMany({ where: { companyId: id } }); await prisma.companySetting.deleteMany({ where: { companyId: id } }); await prisma.company.deleteMany({ where: { id } }); } await app.close(); });

  it("calcula períodos válidos e limita consultas excessivas", () => { const period = analyticsPeriod({ preset: "7d" }, "America/Sao_Paulo"); expect(period.from).toBeInstanceOf(Date); expect(period.to.getTime()).toBeGreaterThan(period.from.getTime()); expect(() => analyticsPeriod({ preset: "custom", from: "2020-01-01", to: "2026-01-01" }, "UTC")).toThrow(); });
  it("entrega dashboard real vazio sem inventar números", async () => { const response = await app.inject({ method: "GET", url: "/api/v1/dashboard/summary?preset=today", headers: { cookie } }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ data: { primary: { received: "0.00", confirmedPayments: 0, averageTicket: "0.00" } } }); });
  it("rejeita filtro de filial pertencente a outra empresa", async () => { const response = await app.inject({ method: "GET", url: `/api/v1/dashboard/summary?preset=7d&branchPublicId=${foreignBranchPublicId}`, headers: { cookie } }); expect(response.statusCode).toBe(400); expect(response.json()).toMatchObject({ error: { code: "FILTER_INVALID" } }); });
  it("pagina relatórios somente no tenant autenticado", async () => { const response = await app.inject({ method: "GET", url: "/api/v1/reports/sales?page=1&pageSize=20", headers: { cookie } }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ data: [], pagination: { total: 0 } }); });
  it("registra configurações sensíveis na auditoria", async () => { const response = await app.inject({ method: "PUT", url: "/api/v1/settings", headers: { cookie }, payload: { displayName: "Gestão atualizada", timezone: "America/Sao_Paulo", defaultPixExpirationMinutes: 30, confirmBeforePix: true, blockDuplicateCode: true, autoPrint: false, printAfterConfirmation: false, autoReturnToSale: false, autoReturnSeconds: 5, blockCloseWithPendingCharges: true, minSaleAmountInCents: 1, maxSaleAmountInCents: 100000000, paymentSoundEnabled: true } }); expect(response.statusCode).toBe(200); expect(await prisma.auditLog.count({ where: { companyId, action: "settings.updated" } })).toBe(1); });
  it("impede usuário de empresa de acessar superadmin", async () => { const response = await app.inject({ method: "GET", url: "/api/v1/platform/dashboard", headers: { cookie } }); expect(response.statusCode).toBe(403); });
});
