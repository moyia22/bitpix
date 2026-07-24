import { describe, expect, it } from "vitest";
import { cashRegisterCreateSchema, permissionKeys } from "@bitpix/contracts";

describe("contratos do caixa com dono", () => {
  it("exige ownerUserPublicId na criação", () => {
    const semDono = cashRegisterCreateSchema.safeParse({
      branchPublicId: "11111111-1111-1111-8111-111111111111",
      name: "Caixa 1",
      code: "CX-1",
    });
    expect(semDono.success).toBe(false);
  });

  it("aceita criação com dono", () => {
    const comDono = cashRegisterCreateSchema.safeParse({
      branchPublicId: "11111111-1111-1111-8111-111111111111",
      name: "Caixa 1",
      code: "CX-1",
      ownerUserPublicId: "22222222-2222-2222-8222-222222222222",
    });
    expect(comDono.success).toBe(true);
  });

  it("expõe a permissão de override", () => {
    expect(permissionKeys).toContain("cash.session.open.any");
  });
});
