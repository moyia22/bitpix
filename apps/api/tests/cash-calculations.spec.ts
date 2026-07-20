import { CashMovementDirection, CashMovementType, Prisma } from "@bitpix/database";
import { describe, expect, it } from "vitest";
import { calculateCashTotals, type CashAmountGroup } from "../src/modules/cash/cash.calculations.js";

const group = (
  type: CashMovementType,
  direction: CashMovementDirection,
  amount: string,
  count = 1,
): CashAmountGroup => ({ type, direction, amount: new Prisma.Decimal(amount), count });

describe("cálculos financeiros do caixa", () => {
  it("calcula saldo esperado sem usar ponto flutuante", () => {
    const totals = calculateCashTotals(new Prisma.Decimal("100.10"), [
      group(CashMovementType.SUPPLY, CashMovementDirection.CREDIT, "0.20"),
      group(CashMovementType.WITHDRAWAL, CashMovementDirection.DEBIT, "0.10"),
    ]);
    expect(totals.expectedBalance.toFixed(2)).toBe("100.20");
  });

  it("combina pagamentos, devoluções e ajustes nas direções corretas", () => {
    const totals = calculateCashTotals(new Prisma.Decimal("100.00"), [
      group(CashMovementType.PIX_PAYMENT, CashMovementDirection.CREDIT, "30.00"),
      group(CashMovementType.PIX_REFUND, CashMovementDirection.DEBIT, "5.00"),
      group(CashMovementType.ADJUSTMENT, CashMovementDirection.CREDIT, "2.50"),
      group(CashMovementType.ADJUSTMENT, CashMovementDirection.DEBIT, "1.25"),
    ]);
    expect(totals.adjustments.toFixed(2)).toBe("1.25");
    expect(totals.expectedBalance.toFixed(2)).toBe("126.25");
  });

  it("mantém Pix confirmado e devoluções em zero quando não existem movimentos de pagamento", () => {
    const totals = calculateCashTotals(new Prisma.Decimal("50.00"), []);
    expect(totals.confirmedPix.toFixed(2)).toBe("0.00");
    expect(totals.refunds.toFixed(2)).toBe("0.00");
    expect(totals.expectedBalance.toFixed(2)).toBe("50.00");
  });
});

