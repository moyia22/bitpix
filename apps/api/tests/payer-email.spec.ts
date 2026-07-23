import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { isValidPayerEmail, resolvePayerEmail } from "../src/modules/payments/payer-email.js";

describe("payer-email — validação", () => {
  it("recusa domínio .local", () => {
    expect(isValidPayerEmail("admin@bitpix.local")).toBe(false);
    expect(isValidPayerEmail("op@sub.bitpix.local")).toBe(false);
  });

  it("recusa e-mail inválido", () => {
    expect(isValidPayerEmail("nao-e-email")).toBe(false);
    expect(isValidPayerEmail("sem-arroba.com")).toBe(false);
    expect(isValidPayerEmail("a@b")).toBe(false); // sem TLD
    expect(isValidPayerEmail("user@localhost")).toBe(false);
    expect(isValidPayerEmail("foo@bar.test")).toBe(false); // TLD reservado
  });

  it("recusa ausência de e-mail", () => {
    expect(isValidPayerEmail(undefined)).toBe(false);
    expect(isValidPayerEmail(null)).toBe(false);
    expect(isValidPayerEmail("")).toBe(false);
    expect(isValidPayerEmail("   ")).toBe(false);
  });

  it("aceita e-mail válido", () => {
    expect(isValidPayerEmail("cliente@gmail.com")).toBe(true);
    expect(isValidPayerEmail("Pagador@Loja.Com.BR")).toBe(true);
    expect(isValidPayerEmail("pix@lojamodelo.com.br")).toBe(true);
  });
});

describe("resolvePayerEmail — prioridade e bloqueio", () => {
  it("prioriza o e-mail do cliente quando válido", () => {
    expect(resolvePayerEmail({ customerEmail: "cliente@gmail.com", companyEmail: "empresa@loja.com.br" })).toBe("cliente@gmail.com");
  });

  it("usa o e-mail da empresa quando o cliente não informa", () => {
    expect(resolvePayerEmail({ customerEmail: undefined, companyEmail: "empresa@loja.com.br" })).toBe("empresa@loja.com.br");
  });

  it("ignora e-mail .local do cliente e cai para o da empresa", () => {
    expect(resolvePayerEmail({ customerEmail: "op@bitpix.local", companyEmail: "empresa@loja.com.br" })).toBe("empresa@loja.com.br");
  });

  it("normaliza para minúsculas e sem espaços", () => {
    expect(resolvePayerEmail({ customerEmail: "  Cliente@Gmail.com  " })).toBe("cliente@gmail.com");
  });

  it("bloqueia com 422 PAYER_EMAIL_REQUIRED quando nenhum e-mail é válido", () => {
    try {
      resolvePayerEmail({ customerEmail: "op@bitpix.local", companyEmail: null });
      throw new Error("deveria ter lançado AppError");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(422);
      expect((error as AppError).code).toBe("PAYER_EMAIL_REQUIRED");
    }
  });
});
