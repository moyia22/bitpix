import { Prisma, type CashMovementDirection, type CashMovementType } from "@bitpix/database";

export interface CashAmountGroup {
  type: CashMovementType;
  direction: CashMovementDirection;
  amount: Prisma.Decimal;
  count: number;
}

export interface CashTotals {
  openingBalance: Prisma.Decimal;
  supplies: Prisma.Decimal;
  withdrawals: Prisma.Decimal;
  confirmedPix: Prisma.Decimal;
  refunds: Prisma.Decimal;
  positiveAdjustments: Prisma.Decimal;
  negativeAdjustments: Prisma.Decimal;
  adjustments: Prisma.Decimal;
  expectedBalance: Prisma.Decimal;
  operationCount: number;
}

const zero = () => new Prisma.Decimal(0);

function sumGroups(
  groups: CashAmountGroup[],
  predicate: (group: CashAmountGroup) => boolean,
): Prisma.Decimal {
  return groups
    .filter(predicate)
    .reduce((total, group) => total.plus(group.amount), zero());
}

export function calculateCashTotals(
  openingBalance: Prisma.Decimal,
  groups: CashAmountGroup[],
): CashTotals {
  const supplies = sumGroups(groups, ({ type }) => type === "SUPPLY");
  const withdrawals = sumGroups(groups, ({ type }) => type === "WITHDRAWAL");
  const confirmedPix = sumGroups(groups, ({ type }) => type === "PIX_PAYMENT");
  const refunds = sumGroups(groups, ({ type }) => type === "PIX_REFUND");
  const isAdjustment = ({ type }: CashAmountGroup) =>
    type === "ADJUSTMENT" || type === "CLOSING_ADJUSTMENT";
  const positiveAdjustments = sumGroups(
    groups,
    (group) => isAdjustment(group) && group.direction === "CREDIT",
  );
  const negativeAdjustments = sumGroups(
    groups,
    (group) => isAdjustment(group) && group.direction === "DEBIT",
  );
  const adjustments = positiveAdjustments.minus(negativeAdjustments);
  const expectedBalance = openingBalance
    .plus(supplies)
    .plus(confirmedPix)
    .plus(positiveAdjustments)
    .minus(withdrawals)
    .minus(refunds)
    .minus(negativeAdjustments);

  return {
    openingBalance,
    supplies,
    withdrawals,
    confirmedPix,
    refunds,
    positiveAdjustments,
    negativeAdjustments,
    adjustments,
    expectedBalance,
    operationCount: groups.reduce((total, group) => total + group.count, 0),
  };
}

