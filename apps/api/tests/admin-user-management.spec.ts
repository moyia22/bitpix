import { vi } from "vitest";

vi.hoisted(() => {
  process.env.REQUIRE_MFA_FOR_ADMINS = "true";
});

import { prisma } from "@bitpix/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { requiresMfa } from "../src/modules/auth/mfa-policy.js";
import { encryptSecret } from "../src/lib/secret-vault.js";
import { generateTotpSecret, totp } from "../src/modules/auth/totp.js";

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

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@bitpix.local";
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

describe("matrícula de 2FA no login do admin", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await prisma.user.update({ where: { normalizedEmail: adminEmail }, data: { mfaEnabled: false, mfaSecretCiphertext: null, mfaSecretIv: null, mfaSecretAuthTag: null } });
  });
  afterAll(async () => { await app.close(); });

  it("cria sessão pendente de matrícula para admin sem MFA", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: adminEmail, password: adminPassword } });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.mfaEnrollmentPending).toBe(true);
  });

  it("bloqueia rota comum e libera /auth/me enquanto pende matrícula", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: adminEmail, password: adminPassword } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const blocked = await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("MFA_ENROLLMENT_REQUIRED");
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });
});

describe("troca de senha própria", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("troca a senha com a senha atual correta", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "operador@bitpix.local", password: adminPassword } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const changed = await app.inject({ method: "POST", url: "/api/v1/auth/password/change", headers: { cookie }, payload: { currentPassword: adminPassword, newPassword: "NovaSenhaForte123" } });
    expect(changed.statusCode).toBe(204);

    // restaura a senha do seed para não quebrar outros testes
    const relogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "operador@bitpix.local", password: "NovaSenhaForte123" } });
    const cookie2 = String(relogin.headers["set-cookie"]).split(";")[0];
    const restored = await app.inject({ method: "POST", url: "/api/v1/auth/password/change", headers: { cookie: cookie2 }, payload: { currentPassword: "NovaSenhaForte123", newPassword: adminPassword! } });
    expect(restored.statusCode).toBe(204);
  });
});

describe("definir senha pelo admin (step-up)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie = "";
  let secret = "";
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    // habilita MFA do admin diretamente para permitir step-up
    secret = generateTotpSecret();
    const admin = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: adminEmail } });
    const enc = encryptSecret(secret, `mfa:${admin.id}`);
    await prisma.user.update({ where: { id: admin.id }, data: { mfaEnabled: true, mfaConfirmedAt: new Date(), mfaSecretCiphertext: enc.ciphertext, mfaSecretIv: enc.iv, mfaSecretAuthTag: enc.authTag } });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: adminEmail, password: adminPassword, mfaCode: totp(secret) } });
    adminCookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  });
  afterAll(async () => {
    await prisma.user.update({ where: { normalizedEmail: adminEmail }, data: { mfaEnabled: false, mfaConfirmedAt: null, mfaSecretCiphertext: null, mfaSecretIv: null, mfaSecretAuthTag: null } });
    await app.close();
  });

  it("recusa sem código de 2FA válido e aceita com código correto", async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: "operador@bitpix.local" }, select: { publicId: true } });
    const noCode = await app.inject({ method: "POST", url: `/api/v1/users/${target.publicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: "TempSenha123456", mfaCode: "000000" } });
    expect([401, 428]).toContain(noCode.statusCode);
    const ok = await app.inject({ method: "POST", url: `/api/v1/users/${target.publicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: "TempSenha123456", mfaCode: totp(secret) } });
    expect(ok.statusCode).toBe(204);
    // restaura a senha do operador
    const t = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: "operador@bitpix.local" }, select: { publicId: true } });
    const restore = await app.inject({ method: "POST", url: `/api/v1/users/${t.publicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: adminPassword!, mfaCode: totp(secret) } });
    expect(restore.statusCode).toBe(204);
  });

  it("bloqueia definir a própria senha", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: adminEmail }, select: { publicId: true } });
    const res = await app.inject({ method: "POST", url: `/api/v1/users/${admin.publicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: "OutraSenhaForte123", mfaCode: totp(secret) } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SELF_PASSWORD_FORBIDDEN");
  });

  it("revoga as sessões ativas do alvo ao definir nova senha", async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: "operador@bitpix.local" } });
    const targetLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "operador@bitpix.local", password: adminPassword } });
    const targetCookie = String(targetLogin.headers["set-cookie"]).split(";")[0];
    const before = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: targetCookie } });
    expect(before.statusCode).toBe(200);

    const set = await app.inject({ method: "POST", url: `/api/v1/users/${target.publicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: "TempSenha123456", requirePasswordChange: true, mfaCode: totp(secret) } });
    expect(set.statusCode).toBe(204);

    const afterRevoke = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: targetCookie } });
    expect(afterRevoke.statusCode).toBe(401);

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { mustResetPassword: true } });
    expect(refreshed.mustResetPassword).toBe(true);

    // restaura a senha e a flag do operador (requirePasswordChange omitido => mustResetPassword volta a false)
    const restore = await app.inject({ method: "POST", url: `/api/v1/users/${target.publicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: adminPassword!, mfaCode: totp(secret) } });
    expect(restore.statusCode).toBe(204);
  });

  it("exclui de vez um usuário sem histórico", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie: adminCookie }, payload: { name: "Descartável", email: `descartavel-${Date.now()}@test.local`, password: "SenhaDescartavel1", roleKeys: ["OPERATOR"] } });
    expect(created.statusCode).toBe(201);
    const publicId = (created.json() as { data: { publicId: string } }).data.publicId;
    const removed = await app.inject({ method: "DELETE", url: `/api/v1/users/${publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as { data: { deleted: boolean } }).data.deleted).toBe(true);
  });

  it("desativa (não exclui) um usuário com histórico", async () => {
    await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "operador@bitpix.local", password: adminPassword } });
    const target = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: "operador@bitpix.local" }, select: { publicId: true } });
    const removed = await app.inject({ method: "DELETE", url: `/api/v1/users/${target.publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as { data: { deactivated: boolean } }).data.deactivated).toBe(true);
    await app.inject({ method: "PATCH", url: `/api/v1/users/${target.publicId}`, headers: { cookie: adminCookie }, payload: { status: "ACTIVE" } });
  });

  it("bloqueia auto-exclusão", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: adminEmail }, select: { publicId: true } });
    const res = await app.inject({ method: "DELETE", url: `/api/v1/users/${admin.publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
    expect(res.statusCode).toBe(409);
  });

  it("recusa exclusão sem step-up de 2FA válido", async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: "operador@bitpix.local" }, select: { publicId: true } });
    const res = await app.inject({ method: "DELETE", url: `/api/v1/users/${target.publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: "000000" } });
    expect([401, 428]).toContain(res.statusCode);
  });

  it("zera o 2FA de um usuário", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie: adminCookie }, payload: { name: "Com MFA", email: `commfa-${Date.now()}@test.local`, password: "SenhaComMfa12345", roleKeys: ["OPERATOR"] } });
    const publicId = (created.json() as { data: { publicId: string } }).data.publicId;
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { publicId } });
    const enc = encryptSecret(generateTotpSecret(), `mfa:${dbUser.id}`);
    await prisma.user.update({ where: { id: dbUser.id }, data: { mfaEnabled: true, mfaSecretCiphertext: enc.ciphertext, mfaSecretIv: enc.iv, mfaSecretAuthTag: enc.authTag } });
    const res = await app.inject({ method: "POST", url: `/api/v1/users/${publicId}/reset-mfa`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
    expect(res.statusCode).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { publicId } });
    expect(after.mfaEnabled).toBe(false);
    await app.inject({ method: "DELETE", url: `/api/v1/users/${publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
  });

  it("cria usuário com exigência de troca no 1º login", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie: adminCookie }, payload: { name: "Troca", email: `troca-${Date.now()}@test.local`, password: "SenhaTroca123456", roleKeys: ["OPERATOR"], requirePasswordChange: true } });
    expect(created.statusCode).toBe(201);
    const publicId = (created.json() as { data: { publicId: string } }).data.publicId;
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { publicId } });
    expect(dbUser.mustResetPassword).toBe(true);
    await app.inject({ method: "DELETE", url: `/api/v1/users/${publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: totp(secret) } });
  });
});
