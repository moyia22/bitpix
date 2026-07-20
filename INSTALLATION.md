# Instalação — BitPix

## Requisitos
- Node.js **22.12+** e npm **10.8+** (o repositório usa `npm@10.9.2`).
- PostgreSQL **17**.
- Redis **8.2** (fila, SSE distribuído, heartbeat do worker).
- Docker Desktop + Docker Compose (opcional em dev; obrigatório para o fluxo em contêiner). Ver `WSL_AND_DOCKER_SETUP.md`.

## 1. Variáveis de ambiente
```bash
cp .env.development.example .env        # desenvolvimento
# ou .env.staging.example / .env.production.example
```
Preencha, no mínimo:
- `POSTGRES_PASSWORD` e o `DATABASE_URL` correspondente;
- `SEED_ADMIN_PASSWORD` (dev);
- `PROVIDER_CREDENTIALS_ENCRYPTION_KEY` com **exatamente 32 bytes em Base64**:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

O boot da API valida o ambiente (`apps/api/src/config/env.ts`). Em `APP_ENV=production` ele **bloqueia** configurações inseguras (mock, HTTP, fallback de webhook, storage efêmero, SMTP ausente, Redis sem auth, MFA off, chave inválida).

## 2. Dependências
```bash
npm install
```

## 3. Banco de dados
Com Docker:
```bash
docker compose up -d postgres redis
```
Ou aponte `DATABASE_URL`/`REDIS_URL` para instâncias já existentes.

```bash
npm run db:generate   # Prisma Client
npm run db:deploy     # aplica migrations (não destrutivo)
npm run db:seed       # cria usuários de exemplo (SOMENTE dev)
```

## 4. Executar
```bash
npm run dev
```
- Web: http://localhost:3000
- API: http://localhost:3333
- Readiness: http://localhost:3333/health/ready
- Métricas: http://localhost:3333/health/metrics

## 5. Execução totalmente em contêiner
```bash
docker compose --profile tools run --rm migrate
docker compose --profile tools run --rm seed
docker compose up -d api worker web
docker compose ps
```

## Verificação
```bash
npm run lint && npm run typecheck && npm run test && npm run build
npm run test:e2e
```
Usuários do seed: `admin@bitpix.local`, `operador@bitpix.local`, `superadmin@bitpix.local` (senha em `SEED_ADMIN_PASSWORD`).
