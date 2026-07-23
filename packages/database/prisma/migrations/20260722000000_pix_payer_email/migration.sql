-- Adiciona o e-mail Pix configurável da empresa (usado como payer.email quando o
-- cliente não informa um). Coluna nullable → migração não destrutiva.
ALTER TABLE "CompanySetting" ADD COLUMN "pixPayerEmail" VARCHAR(180);
