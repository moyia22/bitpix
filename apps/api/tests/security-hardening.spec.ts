import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@bitpix.local";
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const foreignOrigin = "https://evil.example.com";

describe("endurecimento de segurança (CSRF/Origin, auth, webhook público)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let sessionCookie = "";

  beforeAll(async () => {
    if (!adminPassword) throw new Error("SEED_ADMIN_PASSWORD é obrigatória para os testes de integração");
    app = await buildApp();
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: adminEmail, password: adminPassword },
    });
    expect(login.statusCode).toBe(200);
    sessionCookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejeita mutação vinda de Origin não autorizada (defesa CSRF), antes mesmo da autenticação", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { origin: foreignOrigin, cookie: sessionCookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "ORIGIN_REJECTED" } });
  });

  it("exige autenticação em rota protegida quando não há sessão", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/users" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "AUTH_INVALID" } });
  });

  it("permite requisição de leitura (GET) mesmo com Origin externa — só mutações checam Origin", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { origin: foreignOrigin, cookie: sessionCookie },
    });
    expect(response.statusCode).toBe(200);
  });

  it("não aplica verificação de Origin nem exige login no webhook público do Mercado Pago", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/mercado-pago",
      headers: { origin: foreignOrigin, "content-type": "application/json" },
      payload: { type: "payment", data: { id: "1" } },
    });
    // O webhook é público: pode falhar por assinatura/dados, mas NUNCA por Origin.
    expect(response.statusCode).not.toBe(403);
    const code = response.json()?.error?.code;
    expect(code).not.toBe("ORIGIN_REJECTED");
  });
});
