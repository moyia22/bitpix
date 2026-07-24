-- Dono do caixa (vínculo 1:1). Coluna nullable e índice único: migração
-- aditiva/não destrutiva. Caixas existentes ficam sem dono até atribuição.
ALTER TABLE "CashRegister" ADD COLUMN "ownerUserId" TEXT;

CREATE UNIQUE INDEX "CashRegister_ownerUserId_key" ON "CashRegister"("ownerUserId");

ALTER TABLE "CashRegister"
  ADD CONSTRAINT "CashRegister_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
