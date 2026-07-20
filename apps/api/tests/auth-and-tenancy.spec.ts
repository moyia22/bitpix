import { randomUUID } from "node:crypto";
import { prisma } from "@bitpix/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashSessionToken } from "../src/modules/auth/auth.service.js";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@bitpix.local";
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

describe("autenticação e isolamento multiempresa", () => {
  const foreignSlug = `tenant-isolation-${randomUUID().slice(0, 8)}`;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let sessionCookie = "";
  let foreignUserPublicId = "";

  beforeAll(async () => {
    if (!adminPassword) throw new Error("SEED_ADMIN_PASSWORD é obrigatória para os testes de integração");
    app = await buildApp();
    await app.ready();

    const foreignCompany = await prisma.company.create({
      data: {
        legalName: "Tenant de isolamento Ltda",
        displayName: "Tenant de isolamento",
        slug: foreignSlug,
      },
    });
    const foreignUser = await prisma.user.create({
      data: {
        companyId: foreignCompany.id,
        name: "Usuário de outro tenant",
        email: `${foreignSlug}@bitpix.test`,
        normalizedEmail: `${foreignSlug}@bitpix.test`,
        passwordHash: "not-a-login-account",
      },
    });
    foreignUserPublicId = foreignUser.publicId;
  });

  afterAll(async () => {
    const company = await prisma.company.findUnique({ where: { slug: foreignSlug } });
    if (company) {
      await prisma.user.deleteMany({ where: { companyId: company.id } });
      await prisma.company.delete({ where: { id: company.id } });
    }
    await app.close();
  });

  it("gera hashes de sessão determinísticos sem armazenar o token puro", () => {
    const hash = hashSessionToken("token-secreto-de-teste");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashSessionToken("token-secreto-de-teste"));
    expect(hash).not.toContain("token-secreto");
  });

  it("recusa credenciais inválidas com mensagem genérica", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: adminEmail, password: "senha-incorreta" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "AUTH_INVALID" } });
  });

  it("autentica e cria uma sessão HttpOnly revogável", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: adminEmail, password: adminPassword },
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    expect(setCookie).toContain("HttpOnly");
    sessionCookie = String(setCookie).split(";")[0] ?? "";

    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: sessionCookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ data: { user: { email: adminEmail }, company: { slug: "loja-modelo" } } });
  });

  it("não permite consultar um usuário pertencente a outra empresa", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/users/${foreignUserPublicId}`,
      headers: { cookie: sessionCookie },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "USER_NOT_FOUND" } });
  });

  it("revoga a sessão no logout", async () => {
    const logout = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie: sessionCookie } });
    expect(logout.statusCode).toBe(204);
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: sessionCookie } });
    expect(me.statusCode).toBe(401);
  });
});
