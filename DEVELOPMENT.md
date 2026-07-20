# Desenvolvimento — BitPix

## Arquitetura (monorepo)
```
apps/
  api/       Fastify 5 — REST, auth, RBAC, SSE, webhooks, integração MP
  web/       Next.js — TanStack Query, RHF, Zod, tema claro/escuro
  worker/    BullMQ — filas mercado-pago-webhooks, report-exports, maintenance
packages/
  contracts/ Tipos/DTOs compartilhados (Zod)
  database/  Prisma 7 — schema, migrations, client gerado
deploy/      nginx, observabilidade (prometheus/alertas)
scripts/     backup, restore, verify-backup, deploy, rollback
e2e/         Playwright
```

## Comandos
| Ação | Comando |
|------|---------|
| Dev (todos) | `npm run dev` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Testes unit/integração | `npm run test` |
| E2E | `npm run test:e2e` |
| Build | `npm run build` |
| Prisma Client | `npm run db:generate` |
| Nova migration | `npm run db:migrate` |
| Aplicar migrations | `npm run db:deploy` |
| Prisma Studio | `npm run db:studio` |

Turborepo faz cache das tasks; `build`/`lint`/`typecheck`/`test` dependem de `^build`.

## Convenções financeiras
- Valores monetários usam `Decimal` (Prisma), **nunca** float.
- Movimentos `PIX_PAYMENT`/`PIX_REFUND` são criados **somente pelo backend** após confirmação oficial no provedor.
- Confirmação de pagamento é feita por `GET /v1/orders/{id}` — o status do webhook nunca confirma sozinho.

## Fluxo de pagamento (resumo)
1. Operador abre caixa → informa código e valor → API cria cobrança Pix (Orders API).
2. QR Code + Pix Copia e Cola + impressão 58/80 mm.
3. Webhook MP → validação de assinatura HMAC-SHA256 + anti-replay → enfileira job.
4. Worker consulta a Order, confere valores, cria `PixPayment` + `CashMovement` em transação serializável.
5. SSE publica o evento; a interface troca para polling se cair.

## Migrations (regra de ouro)
- **Nunca** editar migrations já aplicadas.
- Preferir **expand/contract** (adicionar antes de remover).
- Evitar operações destrutivas; ver `DEPLOYMENT.md` e `DISASTER_RECOVERY.md`.

## Redis local no Windows (sem Docker)
Se o Docker Desktop não estiver disponível, use a build `redis-windows` (gitignorada em `.runtime/redis`):
```bash
./scripts/dev-redis.sh                          # sobe Redis em 127.0.0.1:6380
npm --workspace @bitpix/worker run start        # worker (outro terminal)
npm run dev                                      # web + api
```
Com Redis + worker ativos, `GET /health/ready` passa de `503 degraded` para `ready`. O binário não é versionado; baixe de github.com/redis-windows/redis-windows e extraia em `.runtime/redis/` se a pasta não existir.

## Testes
- Vitest (`apps/api/tests`) roda contra Postgres real (usa `DATABASE_URL` do `.env`).
- `fileParallelism: false` para isolamento transacional.
- E2E Playwright usa web em `E2E_BASE_URL` e API em 3333.
