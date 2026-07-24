import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  resetPasswordSchema,
  setPasswordSchema,
} from "@bitpix/contracts";

describe("senha mínima de 6 caracteres", () => {
  it("aceita senha de 6 caracteres em createUserSchema", () => {
    const result = createUserSchema.safeParse({
      name: "Fulano",
      email: "fulano@bitpix.test",
      password: "abc123",
      roleKeys: ["OPERADOR"],
    });
    expect(result.success).toBe(true);
  });

  it("rejeita senha de 5 caracteres em createUserSchema", () => {
    const result = createUserSchema.safeParse({
      name: "Fulano",
      email: "fulano@bitpix.test",
      password: "abc12",
      roleKeys: ["OPERADOR"],
    });
    expect(result.success).toBe(false);
  });

  it("aceita senha de 6 no login, troca, definição e reset", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "abc123" }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: "abc123", newPassword: "abc456" }).success).toBe(true);
    expect(setPasswordSchema.safeParse({ password: "abc123", mfaCode: "123456" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ token: "t".repeat(32), password: "abc123" }).success).toBe(true);
  });
});
