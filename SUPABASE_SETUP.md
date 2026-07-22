# BitPix + Supabase — guia de integração

O BitPix usa **Fastify + Prisma** com **autenticação própria** (sessões, Argon2,
RBAC, MFA). O Supabase entra como **Postgres gerenciado** e **Storage (S3)** —
**não** substituímos a autenticação do app pela Auth/RLS do Supabase.

> O que o Supabase cobre aqui: banco + storage. **Redis não** faz parte do
> Supabase — use um Redis gerenciado (ex.: Upstash) para as filas/worker/SSE.

## 1. Criar o projeto
1. Crie um projeto em https://supabase.com (escolha a região mais próxima).
2. Guarde a **senha do banco** (Database password) — ela vai nas connection strings.

## 2. Connection strings (Postgres)
Em **Project Settings → Database → Connection string**:
- **Session pooler** (porta 5432) → use no **`DATABASE_URL`** (runtime do app).
  Suporta prepared statements e é IPv4 (funciona em VPS sem IPv6).
- **Direct connection** (porta 5432, `db.<ref>.supabase.co`) → use no
  **`DIRECT_URL`** (apenas migrations). Se o servidor não tiver IPv6, repita o
  Session pooler no `DIRECT_URL`.

Formato (ver `.env.supabase.example`):
```
DATABASE_URL=postgresql://postgres.<REF>:<SENHA>@aws-0-<REGIAO>.pooler.supabase.com:5432/postgres?sslmode=require
DIRECT_URL=postgresql://postgres.<REF>:<SENHA>@aws-0-<REGIAO>.pooler.supabase.com:5432/postgres?sslmode=require
```

> Por que dois? `DATABASE_URL` (pooler) é ótimo para o runtime; `DIRECT_URL`
> garante que as migrations rodem sem o modo *transaction* do PgBouncer. O
> `prisma.config.ts` já está configurado com `directUrl`.

> **TLS:** basta `?sslmode=require`. O app já lida com a cadeia TLS do pooler do
> Supabase automaticamente (adiciona `uselibpqcompat=true` para hosts remotos no
> runtime), então você não precisa de nenhuma flag extra na connection string.

> **Senha com caracteres especiais:** se a senha do banco tiver `@`, `#`, `/`, `?`
> etc., codifique na URL (ex.: `@` → `%40`), senão a connection string quebra.

## 3. Aplicar o schema (migrations)
Com o `.env` preenchido:
```bash
npm run db:generate
npm run db:deploy     # aplica todas as migrations no Supabase (usa DIRECT_URL)
npm run db:seed       # SOMENTE se quiser dados iniciais (não em produção real)
```
Verifique no Supabase → **Table Editor** que as tabelas (Company, User, PixCharge…)
foram criadas.

## 4. Storage (S3-compatível)
1. Supabase → **Storage** → crie um **bucket privado** (ex.: `bitpix`). Não deixe público.
2. Supabase → **Storage → Settings → S3 Access Keys** → gere uma chave.
3. Preencha no `.env`:
```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<REF>.supabase.co/storage/v1/s3
S3_REGION=<REGIAO>
S3_BUCKET=bitpix
S3_ACCESS_KEY=<...>
S3_SECRET_KEY=<...>
S3_FORCE_PATH_STYLE=true
S3_SERVER_SIDE_ENCRYPTION=none
```
O BitPix já suporta S3 (logos, exportações) com URLs assinadas e validação de MIME.

## 5. Redis (fora do Supabase)
Crie um Redis gerenciado (ex.: Upstash) com TLS + senha e use no `REDIS_URL`:
```
REDIS_URL=rediss://default:<SENHA>@<HOST>.upstash.io:6379
```
Em produção o `env.ts` exige Redis com autenticação.

## 6. Validar
```bash
npm run typecheck && npm run build
npm run db:deploy
# suba a API/worker apontando para o Supabase e cheque:
curl https://SEU_DOMINIO/health/ready   # deve retornar "ready"
```

## Notas de segurança
- Bucket **privado**; nunca exponha as chaves S3.
- Use a senha forte do banco; rotacione se vazar.
- Backups: o Supabase mantém backups gerenciados; ainda assim, os scripts em
  `scripts/backup.sh` podem gerar backups lógicos adicionais (defina
  `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` a partir da Direct connection).
- Não habilite RLS supondo que ela protege o app — o BitPix acessa o banco com
  um único papel de serviço e faz a autorização na aplicação (RBAC/tenant).
