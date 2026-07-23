import { vi } from "vitest";

vi.hoisted(() => {
  process.env.REQUIRE_MFA_FOR_ADMINS = "true";
});

import { prisma } from "@bitpix/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { requiresMfa } from "../src/modules/auth/mfa-policy.js";
import { totp } from "../src/modules/auth/totp.js";
import { createTestTenant, enableTestMfa, type TestTenant } from "./helpers/tenant.js";

describe("requiresMfa", () => {
  it("exige MFA para platform admin", () => {
    expect(requiresMfa({ isPlatformAdmin: true }, [])).toBe(true);
  });
  it("exige MFA para quem gerencia usuários ou funções", () => {
    expect(requiresMfa({ isPlatformAdmin: false }, ["sales.create", "users.manage"])).toBe(true);
    expect(requiresMfa({ isPlatformAdmin: false }, ["roles.read"])).toBe(true);
  });
  it("não exige MFA para operador padrão", () => {
    expect(requiresMfa({ isPlatformAdmin: false }, ["sales.create", "cash.session.open"])).toBe(false);
  });
});

// Tenant HERMÉTICO: os testes nunca tocam nas contas reais/seed do banco compartilhado.
// Cada bloco usa a própria instância do app: o rate limit do login (5/min) é em
// memória por instância e estouraria com todos os logins num app só.
describe.sequential("gestão de usuários e 2FA (tenant isolado)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTestTenant("adm-mgmt");
  });
  afterAll(async () => {
    await tenant.cleanup();
  });

  describe.sequential("matrícula de 2FA no login do admin", () => {
    beforeAll(async () => { app = await buildApp(); await app.ready(); });
    afterAll(async () => { await app.close(); });
    it("cria sessão pendente de matrícula para admin sem MFA", async () => {
      const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: tenant.adminEmail, password: tenant.password } });
      expect(login.statusCode).toBe(200);
      expect(login.json().data.mfaEnrollmentPending).toBe(true);
    });

    it("bloqueia rota comum e libera /auth/me enquanto pende matrícula", async () => {
      const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: tenant.adminEmail, password: tenant.password } });
      const cookie = String(login.headers["set-cookie"]).split(";")[0];
      const blocked = await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie } });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.code).toBe("MFA_ENROLLMENT_REQUIRED");
      const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
      expect(me.statusCode).toBe(200);
    });
  });

  describe.sequential("troca de senha própria", () => {
    beforeAll(async () => { app = await buildApp(); await app.ready(); });
    afterAll(async () => { await app.close(); });

    it("troca a senha com a senha atual correta e continua conseguindo entrar", async () => {
      const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: tenant.operatorEmail, password: tenant.password } });
      const cookie = String(login.headers["set-cookie"]).split(";")[0];
      const changed = await app.inject({ method: "POST", url: "/api/v1/auth/password/change", headers: { cookie }, payload: { currentPassword: tenant.password, newPassword: "NovaSenhaForte123" } });
      expect(changed.statusCode).toBe(204);

      const relogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: tenant.operatorEmail, password: "NovaSenhaForte123" } });
      expect(relogin.statusCode).toBe(200);
      const cookie2 = String(relogin.headers["set-cookie"]).split(";")[0];
      const restored = await app.inject({ method: "POST", url: "/api/v1/auth/password/change", headers: { cookie: cookie2 }, payload: { currentPassword: "NovaSenhaForte123", newPassword: tenant.password } });
      expect(restored.statusCode).toBe(204);
    });
  });

  describe.sequential("ações administrativas com step-up de 2FA", () => {
    let adminCookie = "";
    let secret = "";

    beforeAll(async () => {
      app = await buildApp();
      await app.ready();
      secret = await enableTestMfa(tenant.adminId);
      const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: tenant.adminEmail, password: tenant.password, mfaCode: totp(secret) } });
      expect(login.statusCode).toBe(200);
      adminCookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    });
    afterAll(async () => { await app.close(); });

    it("com 2FA ATIVO, senha sozinha não inicia novo setup (não desativa o 2FA)", async () => {
      const res = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup", headers: { cookie: adminCookie }, payload: { password: tenant.password } });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("MFA_ALREADY_ENABLED");
      const admin = await prisma.user.findUniqueOrThrow({ where: { id: tenant.adminId }, select: { mfaEnabled: true, mfaSecretCiphertext: true } });
      expect(admin.mfaEnabled).toBe(true);
      expect(admin.mfaSecretCiphertext).not.toBeNull();
    });

    it("recusa sem código de 2FA válido e aceita com código correto", async () => {
      const noCode = await app.inject({ method: "POST", url: `/api/v1/users/${tenant.operatorPublicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: "TempSenha123456", mfaCode: "000000" } });
      expect([401, 428]).toContain(noCode.statusCode);
      const ok = await app.inject({ method: "POST", url: `/api/v1/users/${tenant.operatorPublicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: "TempSenha123456", mfaCode: totp(secret) } });
      expect(ok.statusCode).toBe(204);
      const restore = await app.inject({ method: "POST", url: `/api/v1/users/${tenant.operatorPublicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: tenant.password, mfaCode: totp(secret) } });
      expect(restore.statusCode).toBe(204);
    });

    it("bloqueia definir a própria senha", async () => {
      const res = await app.inject({ method: "POST", url: `/api/v1/users/${tenant.adminPublicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: "OutraSenhaForte123", mfaCode: totp(secret) } });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("SELF_PASSWORD_FORBIDDEN");
    });

    it("revoga as sessões ativas do alvo ao definir nova senha", async () => {
      const targetLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: tenant.operatorEmail, password: tenant.password } });
      const targetCookie = String(targetLogin.headers["set-cookie"]).split(";")[0];
      const before = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: targetCookie } });
      expect(before.statusCode).toBe(200);

      const set = await app.inject({ method: "POST", url: `/api/v1/users/${tenant.operatorPublicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: "TempSenha123456", requirePasswordChange: true, mfaCode: totp(secret) } });
      expect(set.statusCode).toBe(204);

      const afterRevoke = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: targetCookie } });
      expect(afterRevoke.statusCode).toBe(401);

      const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: tenant.operatorId }, select: { mustResetPassword: true } });
      expect(refreshed.mustResetPassword).toBe(true);

      const restore = await app.inject({ method: "POST", url: `/api/v1/users/${tenant.operatorPublicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: tenant.password, mfaCode: totp(secret) } });
      expect(restore.statusCode).toBe(204);
    });

    it("exclui de vez um usuário sem histórico", async () => {
      const created = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie: adminCookie }, payload: { name: "Descartável", email: `descartavel-${tenant.suffix}@test.local`, password: "SenhaDescartavel1", roleKeys: ["OPERATOR"] } });
      expect(created.statusCode).toBe(201);
      const publicId = (created.json() as { data: { publicId: string } }).data.publicId;
      const removed = await app.inject({ method: "DELETE", url: `/api/v1/users/${publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
      expect(removed.statusCode).toBe(200);
      expect((removed.json() as { data: { deleted: boolean } }).data.deleted).toBe(true);
    });

    it("desativa (não exclui) um usuário com histórico", async () => {
      const removed = await app.inject({ method: "DELETE", url: `/api/v1/users/${tenant.operatorPublicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
      expect(removed.statusCode).toBe(200);
      expect((removed.json() as { data: { deactivated: boolean } }).data.deactivated).toBe(true);
      const reactivated = await app.inject({ method: "PATCH", url: `/api/v1/users/${tenant.operatorPublicId}`, headers: { cookie: adminCookie }, payload: { status: "ACTIVE" } });
      expect(reactivated.statusCode).toBe(200);
    });

    it("bloqueia auto-exclusão", async () => {
      const res = await app.inject({ method: "DELETE", url: `/api/v1/users/${tenant.adminPublicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
      expect(res.statusCode).toBe(409);
    });

    it("recusa exclusão sem step-up de 2FA válido", async () => {
      const res = await app.inject({ method: "DELETE", url: `/api/v1/users/${tenant.operatorPublicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: "000000" } });
      expect([401, 428]).toContain(res.statusCode);
    });

    it("zera o 2FA de um usuário", async () => {
      const created = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie: adminCookie }, payload: { name: "Com MFA", email: `commfa-${tenant.suffix}@test.local`, password: "SenhaComMfa12345", roleKeys: ["OPERATOR"] } });
      const publicId = (created.json() as { data: { publicId: string } }).data.publicId;
      const dbUser = await prisma.user.findUniqueOrThrow({ where: { publicId } });
      await enableTestMfa(dbUser.id);
      const res = await app.inject({ method: "POST", url: `/api/v1/users/${publicId}/reset-mfa`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
      expect(res.statusCode).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { publicId } });
      expect(after.mfaEnabled).toBe(false);
      await app.inject({ method: "DELETE", url: `/api/v1/users/${publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
    });

    it("cria usuário com exigência de troca no 1º login", async () => {
      const created = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie: adminCookie }, payload: { name: "Troca", email: `troca-${tenant.suffix}@test.local`, password: "SenhaTroca123456", roleKeys: ["OPERATOR"], requirePasswordChange: true } });
      expect(created.statusCode).toBe(201);
      const publicId = (created.json() as { data: { publicId: string } }).data.publicId;
      const dbUser = await prisma.user.findUniqueOrThrow({ where: { publicId } });
      expect(dbUser.mustResetPassword).toBe(true);
      await app.inject({ method: "DELETE", url: `/api/v1/users/${publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
    });
  });
});
