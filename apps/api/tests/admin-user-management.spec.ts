import { vi } from "vitest";

vi.hoisted(() => {
  process.env.REQUIRE_MFA_FOR_ADMINS = "true";
});

import { prisma } from "@bitpix/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { requiresMfa } from "../src/modules/auth/auth.guard.js";

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
