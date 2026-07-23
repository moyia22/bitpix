-- Catálogo rápido de produtos/valores da empresa (array JSON de {name, amountInCents}).
-- Coluna nullable → migração aditiva, não destrutiva.
ALTER TABLE "CompanySetting" ADD COLUMN "quickItems" JSONB;
