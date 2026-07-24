import { randomUUID } from "node:crypto";
import { permissionKeys } from "@bitpix/contracts";
import { CashRegisterStatus, prisma } from "@bitpix/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashSessionToken } from "../src/modules/auth/auth.service.js";

describe.sequential("controle operacional de caixa", () => {
  const suffix = randomUUID().slice(0, 8);
  const tenantSlug = `cash-tests-${suffix}`;
  const foreignSlug = `cash-foreign-${suffix}`;
  const adminToken = `cash-admin-${randomUUID()}`;
  const deniedToken = `cash-denied-${randomUUID()}`;
  const ownerToken = `cash-owner-${randomUUID()}`;
  const plainOperatorToken = `cash-plain-${randomUUID()}`;
  const cookieName = process.env.SESSION_COOKIE_NAME ?? "bitpix_session";
  const adminCookie = `${cookieName}=${adminToken}`;
  const deniedCookie = `${cookieName}=${deniedToken}`;
  const ownerCookie = `${cookieName}=${ownerToken}`;
  const plainOperatorCookie = `${cookieName}=${plainOperatorToken}`;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let companyId = "";
  let branchId = "";
  let branchPublicId = "";
  let registerPublicId = "";
  let secondRegisterPublicId = "";
  let currentSessionPublicId = "";
  let foreignCompanyId = "";
  let foreignRegisterPublicId = "";
  let ownerUserPublicId = "";
  let secondOwnerPublicId = "";
  let thirdOwnerId = "";

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const company = await prisma.company.create({
      data: { legalName: "Caixa Testes Ltda", displayName: "Caixa Testes", slug: tenantSlug },
    });
    companyId = company.id;
    const branch = await prisma.branch.create({
      data: { companyId, code: "MATRIZ", name: "Matriz Testes" },
    });
    branchId = branch.id;
    branchPublicId = branch.publicId;

    const cashPermissionKeys = permissionKeys.filter((key) => key.startsWith("cash.") || key === "sales.create");
    const permissions = [];
    for (const key of cashPermissionKeys) {
      const permission = await prisma.permission.upsert({
        where: { key },
        create: { key, name: key, description: `Permissão de teste ${key}` },
        update: {},
      });
      permissions.push(permission);
    }
    const role = await prisma.role.create({
      data: { companyId, key: "CASH_TESTER", name: "Operador de testes" },
    });
    await prisma.rolePermission.createMany({
      data: permissions
        .filter((permission) => permission.key !== "cash.movement.withdrawal.override")
        .map((permission) => ({ companyId, roleId: role.id, permissionId: permission.id })),
    });
    const admin = await prisma.user.create({
      data: {
        companyId,
        branchId,
        name: "Operador Testes",
        email: `cash-admin-${suffix}@bitpix.test`,
        normalizedEmail: `cash-admin-${suffix}@bitpix.test`,
        passwordHash: "not-used",
      },
    });
    await prisma.userRole.create({ data: { companyId, userId: admin.id, roleId: role.id } });
    await prisma.userSession.create({
      data: {
        companyId,
        userId: admin.id,
        tokenHash: hashSessionToken(adminToken),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const ownerUser = await prisma.user.create({
      data: {
        companyId,
        branchId,
        name: "Dono do Caixa",
        email: `cash-owner-${suffix}@bitpix.test`,
        normalizedEmail: `cash-owner-${suffix}@bitpix.test`,
        passwordHash: "not-used",
      },
    });
    ownerUserPublicId = ownerUser.publicId;

    const secondOwner = await prisma.user.create({
      data: {
        companyId,
        branchId,
        name: "Segundo Dono",
        email: `cash-second-owner-${suffix}@bitpix.test`,
        normalizedEmail: `cash-second-owner-${suffix}@bitpix.test`,
        passwordHash: "not-used",
      },
    });
    secondOwnerPublicId = secondOwner.publicId;

    const thirdOwner = await prisma.user.create({
      data: {
        companyId,
        branchId,
        name: "Terceiro Dono",
        email: `cash-third-owner-${suffix}@bitpix.test`,
        normalizedEmail: `cash-third-owner-${suffix}@bitpix.test`,
        passwordHash: "not-used",
      },
    });
    thirdOwnerId = thirdOwner.id;

    const openOnlyRole = await prisma.role.create({
      data: { companyId, key: "CASH_OPEN_ONLY", name: "Operador dono" },
    });
    const openPerm = await prisma.permission.findUniqueOrThrow({ where: { key: "cash.session.open" } });
    const closePerm = await prisma.permission.findUniqueOrThrow({ where: { key: "cash.session.close" } });
    const readPerm = await prisma.permission.findUniqueOrThrow({ where: { key: "cash.session.read" } });
    await prisma.rolePermission.createMany({
      data: [openPerm, closePerm, readPerm].map((permission) => ({ companyId, roleId: openOnlyRole.id, permissionId: permission.id })),
    });
    await prisma.userRole.create({ data: { companyId, userId: ownerUser.id, roleId: openOnlyRole.id } });
    await prisma.userSession.create({
      data: { companyId, userId: ownerUser.id, tokenHash: hashSessionToken(ownerToken), expiresAt: new Date(Date.now() + 3_600_000) },
    });

    const plainOperator = await prisma.user.create({
      data: {
        companyId,
        branchId,
        name: "Operador Sem Caixa",
        email: `cash-plain-${suffix}@bitpix.test`,
        normalizedEmail: `cash-plain-${suffix}@bitpix.test`,
        passwordHash: "not-used",
      },
    });
    await prisma.userRole.create({ data: { companyId, userId: plainOperator.id, roleId: openOnlyRole.id } });
    await prisma.userSession.create({
      data: { companyId, userId: plainOperator.id, tokenHash: hashSessionToken(plainOperatorToken), expiresAt: new Date(Date.now() + 3_600_000) },
    });

    const deniedRole = await prisma.role.create({
      data: { companyId, key: "NO_CASH", name: "Sem acesso ao caixa" },
    });
    const deniedUser = await prisma.user.create({
      data: {
        companyId,
        branchId,
        name: "Usuário Sem Permissão",
        email: `cash-denied-${suffix}@bitpix.test`,
        normalizedEmail: `cash-denied-${suffix}@bitpix.test`,
        passwordHash: "not-used",
      },
    });
    await prisma.userRole.create({ data: { companyId, userId: deniedUser.id, roleId: deniedRole.id } });
    await prisma.userSession.create({
      data: {
        companyId,
        userId: deniedUser.id,
        tokenHash: hashSessionToken(deniedToken),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const foreignCompany = await prisma.company.create({
      data: { legalName: "Empresa Externa Ltda", displayName: "Empresa Externa", slug: foreignSlug },
    });
    foreignCompanyId = foreignCompany.id;
    const foreignBranch = await prisma.branch.create({
      data: { companyId: foreignCompany.id, code: "EXT", name: "Filial Externa" },
    });
    const foreignOwner = await prisma.user.create({
      data: {
        companyId: foreignCompany.id,
        branchId: foreignBranch.id,
        name: "Dono Externo",
        email: `cash-foreign-owner-${suffix}@bitpix.test`,
        normalizedEmail: `cash-foreign-owner-${suffix}@bitpix.test`,
        passwordHash: "not-used",
      },
    });
    const foreignRegister = await prisma.cashRegister.create({
      data: { companyId: foreignCompany.id, branchId: foreignBranch.id, code: "EXT-01", name: "Caixa externo", ownerUserId: foreignOwner.id },
    });
    foreignRegisterPublicId = foreignRegister.publicId;
  }, 30_000);

  afterAll(async () => {
    for (const id of [companyId, foreignCompanyId]) {
      if (!id) continue;
      await prisma.auditLog.deleteMany({ where: { companyId: id } });
      await prisma.sale.deleteMany({ where: { companyId: id } });
      await prisma.cashMovement.deleteMany({ where: { companyId: id } });
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
  }, 30_000);

  it("cadastra um caixa com dono dentro da filial acessível", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-registers",
      headers: { cookie: adminCookie },
      payload: { branchPublicId, code: "CX-TESTE", name: "Caixa de testes", description: "Integração", ownerUserPublicId },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.owner).toMatchObject({ publicId: ownerUserPublicId, name: "Dono do Caixa" });
    registerPublicId = response.json().data.publicId;
  });

  it("recusa cadastro de segundo caixa para o mesmo dono", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-registers",
      headers: { cookie: adminCookie },
      payload: { branchPublicId, code: "CX-DUP-OWNER", name: "Outro", ownerUserPublicId },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "CASH_REGISTER_OWNER_TAKEN" } });
  });

  it("impede código duplicado na mesma empresa e filial", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-registers",
      headers: { cookie: adminCookie },
      payload: { branchPublicId, code: "cx-teste", name: "Duplicado", ownerUserPublicId: secondOwnerPublicId },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "CASH_REGISTER_CODE_EXISTS" } });
  });

  it("prepara um segundo caixa para validar exclusividade do operador", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-registers",
      headers: { cookie: adminCookie },
      payload: { branchPublicId, code: "CX-SECOND", name: "Segundo caixa", ownerUserPublicId: secondOwnerPublicId },
    });
    expect(response.statusCode).toBe(201);
    secondRegisterPublicId = response.json().data.publicId;
  });

  it("impede abertura de caixa inativo", async () => {
    const inactive = await prisma.cashRegister.create({
      data: { companyId, branchId, code: "CX-OFF", name: "Caixa inativo", status: CashRegisterStatus.INACTIVE, ownerUserId: thirdOwnerId },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: adminCookie },
      payload: { cashRegisterPublicId: inactive.publicId, openingBalanceInCents: 0 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "CASH_REGISTER_INACTIVE" } });
  });

  it("impede abertura de caixa de outra empresa sem revelar o recurso", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: adminCookie },
      payload: { cashRegisterPublicId: foreignRegisterPublicId, openingBalanceInCents: 1000 },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "CASH_REGISTER_NOT_FOUND" } });
  });

  it("abre o caixa em transação e cria o saldo inicial", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: adminCookie },
      payload: { cashRegisterPublicId: registerPublicId, openingBalanceInCents: 10000, note: "Turno de teste" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ data: { status: "OPEN", totals: { openingBalance: "100.00", expectedBalance: "100.00", confirmedPix: "0.00" } } });
    currentSessionPublicId = response.json().data.publicId;
  });

  it("impede duas sessões abertas para o mesmo caixa", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: adminCookie },
      payload: { cashRegisterPublicId: registerPublicId, openingBalanceInCents: 0 },
    });
    expect(response.statusCode).toBe(409);
  });

  it("impede que o operador abra simultaneamente um segundo caixa", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: adminCookie },
      payload: { cashRegisterPublicId: secondRegisterPublicId, openingBalanceInCents: 0 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "OPERATOR_ALREADY_HAS_OPEN_SESSION" } });
  });

  it("consulta a sessão atual do operador", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/cash-sessions/current", headers: { cookie: adminCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { publicId: currentSessionPublicId, status: "OPEN" } });
  });

  it("registra suprimento imutável e recalcula os totais", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/cash-sessions/${currentSessionPublicId}/supplies`,
      headers: { cookie: adminCookie },
      payload: { amountInCents: 5000, reason: "Troco adicional" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ data: { session: { totals: { supplies: "50.00", expectedBalance: "150.00" } } } });
  });

  it("registra sangria dentro do saldo operacional", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/cash-sessions/${currentSessionPublicId}/withdrawals`,
      headers: { cookie: adminCookie },
      payload: { amountInCents: 2000, reason: "Envio ao cofre" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ data: { session: { totals: { withdrawals: "20.00", expectedBalance: "130.00" } } } });
  });

  it("impede sangria superior ao saldo sem permissão administrativa específica", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/cash-sessions/${currentSessionPublicId}/withdrawals`,
      headers: { cookie: adminCookie },
      payload: { amountInCents: 20000, reason: "Valor excedente" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "WITHDRAWAL_EXCEEDS_BALANCE" } });
  });

  it("calcula o saldo esperado exclusivamente no backend", async () => {
    const response = await app.inject({ method: "GET", url: `/api/v1/cash-sessions/${currentSessionPublicId}`, headers: { cookie: adminCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { totals: { openingBalance: "100.00", supplies: "50.00", withdrawals: "20.00", confirmedPix: "0.00", expectedBalance: "130.00" } } });
  });

  it("pagina as movimentações no servidor", async () => {
    const response = await app.inject({ method: "GET", url: `/api/v1/cash-sessions/${currentSessionPublicId}/movements?page=1&pageSize=2`, headers: { cookie: adminCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(2);
    expect(response.json().pagination.total).toBe(3);
    expect(response.json().pagination.totalPages).toBe(2);
  });

  it("habilita a preparação de venda apenas com caixa aberto e não persiste venda", async () => {
    const before = await prisma.sale.count({ where: { companyId } });
    const response = await app.inject({ method: "POST", url: "/api/v1/sales/prepare", headers: { cookie: adminCookie }, payload: { code: "PED-1", amountInCents: 1250 } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { ready: true, persisted: false } });
    expect(await prisma.sale.count({ where: { companyId } })).toBe(before);
  });

  it("fecha sem divergência e persiste os valores de conferência", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/cash-sessions/${currentSessionPublicId}/close`,
      headers: { cookie: adminCookie },
      payload: { countedBalanceInCents: 13000, note: "Conferido", confirmed: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { status: "CLOSED", expectedBalance: "130.00", countedBalance: "130.00", discrepancy: "0.00" } });
  });

  it("impede movimentação em sessão fechada e audita a tentativa", async () => {
    const response = await app.inject({ method: "POST", url: `/api/v1/cash-sessions/${currentSessionPublicId}/supplies`, headers: { cookie: adminCookie }, payload: { amountInCents: 100, reason: "Tentativa fechada" } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "CASH_SESSION_CLOSED" } });
  });

  it("impede fechamento duplicado", async () => {
    const response = await app.inject({ method: "POST", url: `/api/v1/cash-sessions/${currentSessionPublicId}/close`, headers: { cookie: adminCookie }, payload: { countedBalanceInCents: 13000, confirmed: true } });
    expect(response.statusCode).toBe(409);
  });

  it("bloqueia preparação de venda quando não existe caixa aberto", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/sales/prepare", headers: { cookie: adminCookie }, payload: { code: "PED-2", amountInCents: 1000 } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "OPEN_CASH_SESSION_REQUIRED" } });
  });

  it("registra divergência positiva", async () => {
    const opened = await app.inject({ method: "POST", url: "/api/v1/cash-sessions/open", headers: { cookie: adminCookie }, payload: { cashRegisterPublicId: secondRegisterPublicId, openingBalanceInCents: 10000 } });
    const publicId = opened.json().data.publicId;
    const closed = await app.inject({ method: "POST", url: `/api/v1/cash-sessions/${publicId}/close`, headers: { cookie: adminCookie }, payload: { countedBalanceInCents: 12000, confirmed: true } });
    expect(closed.json()).toMatchObject({ data: { discrepancy: "20.00" } });
  });

  it("registra divergência negativa", async () => {
    const opened = await app.inject({ method: "POST", url: "/api/v1/cash-sessions/open", headers: { cookie: adminCookie }, payload: { cashRegisterPublicId: secondRegisterPublicId, openingBalanceInCents: 10000 } });
    const publicId = opened.json().data.publicId;
    const closed = await app.inject({ method: "POST", url: `/api/v1/cash-sessions/${publicId}/close`, headers: { cookie: adminCookie }, payload: { countedBalanceInCents: 8000, confirmed: true } });
    expect(closed.json()).toMatchObject({ data: { discrepancy: "-20.00" } });
  });

  it("aplica permissões no backend e audita a negação", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/cash-registers", headers: { cookie: deniedCookie } });
    expect(response.statusCode).toBe(403);
    const audit = await prisma.auditLog.findFirst({ where: { companyId, action: "authorization.denied", entityPublicId: "cash.register.read" } });
    expect(audit).not.toBeNull();
  });

  it("impede IDOR e mantém isolamento entre empresas", async () => {
    const response = await app.inject({ method: "GET", url: `/api/v1/cash-registers/${foreignRegisterPublicId}`, headers: { cookie: adminCookie } });
    expect(response.statusCode).toBe(404);
    const audit = await prisma.auditLog.findFirst({ where: { companyId, action: "tenant.access.denied", entityPublicId: foreignRegisterPublicId } });
    expect(audit).not.toBeNull();
  });

  it("permite o dono abrir o próprio caixa", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: ownerCookie },
      payload: { cashRegisterPublicId: registerPublicId, openingBalanceInCents: 5000 },
    });
    expect(response.statusCode).toBe(201);
    // fecha para não interferir nos próximos testes
    await app.inject({
      method: "POST",
      url: `/api/v1/cash-sessions/${response.json().data.publicId}/close`,
      headers: { cookie: ownerCookie },
      payload: { countedBalanceInCents: 5000, note: null, confirmed: true },
    });
  });

  it("bloqueia não-dono sem permissão de override", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: plainOperatorCookie },
      payload: { cashRegisterPublicId: registerPublicId, openingBalanceInCents: 0 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "CASH_REGISTER_NOT_OWNER" } });
  });

  it("permite admin com override abrir caixa de outro dono e audita", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: adminCookie },
      payload: { cashRegisterPublicId: registerPublicId, openingBalanceInCents: 0 },
    });
    expect(response.statusCode).toBe(201);
    const audit = await prisma.auditLog.findFirst({ where: { companyId, action: "cash.session.opened.override" } });
    expect(audit).not.toBeNull();
    // fecha para não deixar sessão residual aberta para os testes seguintes
    await app.inject({
      method: "POST",
      url: `/api/v1/cash-sessions/${response.json().data.publicId}/close`,
      headers: { cookie: adminCookie },
      payload: { countedBalanceInCents: 0, confirmed: true },
    });
  });

  it("cria auditoria para todas as operações financeiras sensíveis", async () => {
    const actions = await prisma.auditLog.findMany({
      where: { companyId, action: { in: ["cash.register.created", "cash.session.opened", "cash.movement.supplied", "cash.movement.withdrawn", "cash.session.closed", "cash.movement.denied.closed"] } },
      select: { action: true },
    });
    expect(new Set(actions.map(({ action }) => action))).toEqual(new Set(["cash.register.created", "cash.session.opened", "cash.movement.supplied", "cash.movement.withdrawn", "cash.session.closed", "cash.movement.denied.closed"]));
  });

  it("rejeita movimentação para sessão inexistente", async () => {
    const response = await app.inject({ method: "POST", url: `/api/v1/cash-sessions/${randomUUID()}/supplies`, headers: { cookie: adminCookie }, payload: { amountInCents: 100, reason: "Sem sessão" } });
    expect(response.statusCode).toBe(404);
  });
});
