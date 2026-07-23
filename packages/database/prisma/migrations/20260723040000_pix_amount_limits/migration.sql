-- Limites de valor do Pix por empresa (aviso e bloqueio). Colunas nullable,
-- migração aditiva/não destrutiva.
ALTER TABLE "CompanySetting" ADD COLUMN "pixReviewAmount" DECIMAL(18,2);
ALTER TABLE "CompanySetting" ADD COLUMN "pixBlockAmount" DECIMAL(18,2);
