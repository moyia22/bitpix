-- PostgreSQL partial indexes complement the application-level transaction checks.
-- They guarantee that races cannot create two active sessions for a register or operator.
CREATE UNIQUE INDEX "CashSession_one_open_per_register"
ON "CashSession" ("cashRegisterId")
WHERE "status" = 'OPEN';

CREATE UNIQUE INDEX "CashSession_one_open_per_operator"
ON "CashSession" ("operatorId")
WHERE "status" = 'OPEN';

ALTER TABLE "CashSession"
ADD CONSTRAINT "CashSession_openingAmount_nonnegative"
CHECK ("openingAmount" >= 0);

ALTER TABLE "CashMovement"
ADD CONSTRAINT "CashMovement_amount_nonnegative"
CHECK ("amount" >= 0);

