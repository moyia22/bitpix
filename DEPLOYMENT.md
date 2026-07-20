# Deploy — BitPix

## Ambientes
| Ambiente | Compose | Provider | Storage | Fallback webhook |
|----------|---------|----------|---------|------------------|
| development | `docker-compose.yml` | mock | local | permitido |
| staging | `+ docker-compose.staging.yml` | real (teste) | MinIO (S3) | proibido |
| production | `+ docker-compose.production.yml` | real | S3/R2 | proibido |

O boot (`env.ts`) **falha** em produção se algo inseguro for detectado.

## Pré-requisitos de produção
- Domínio + DNS para web e API.
- Certificado TLS válido (`deploy/nginx/certs/fullchain.pem` e `privkey.pem`).
- Segredos em secret manager / variáveis do host (nunca no repositório).
- Redis com senha (`REDIS_PASSWORD`), S3 privado, SMTP autenticado.

## Deploy (staging)
```bash
cp .env.staging.example .env   # preencha segredos
ENVIRONMENT=staging ./scripts/deploy.sh
```
O script executa: validação de config → git → **backup** → build → testes essenciais → migrations → redis/worker → api → web/proxy → readiness → smoke tests.

## Deploy (produção)
```bash
cp .env.production.example .env  # preencha via secret manager
ENVIRONMENT=production ./scripts/deploy.sh
```
Requisitos verificados: readiness `ready` (Redis + worker obrigatórios), `/health/live`, `/health/version`, `/login`.

## Proxy reverso
`deploy/nginx/bitpix.conf` + `bitpix.routes.inc`:
- `/api/` → API; SSE (`/api/v1/pix/charges/*/events`) com `proxy_buffering off` e timeout 3600s.
- Webhook `/api/v1/webhooks/mercado-pago`: corpo original preservado, IP real, rate limit dedicado, **sem** login.
- `/` → web (Next.js). `/healthz` → health do próprio proxy.
- HTTPS/HSTS: blocos comentados — habilite após validar TLS.

## CI/CD
- `.github/workflows/ci.yml`: install → lint → typecheck → test (Postgres+Redis) → e2e → build → `npm audit` → build de imagem → scan Trivy.
- `.github/workflows/deploy.yml`: staging automático em tags; **produção exige aprovação manual** (GitHub Environment protegido). Nunca faz deploy de produção a cada push.

## Regras de deploy
- **NUNCA** `docker compose down -v` (destrói volumes).
- **NUNCA** rodar `db:seed` (desenvolvimento) em produção.
- Backup **antes** de qualquer migration.
- Migrations não destrutivas (expand/contract).

## Rollback
```bash
ENVIRONMENT=production IMAGE_TAG=<sha_anterior> ./scripts/rollback.sh
```
Ver `DISASTER_RECOVERY.md` para rollback de dados/schema.
