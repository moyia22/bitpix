# BitPix

Plataforma SaaS multiempresa para cobranças Pix em lojas físicas. A Fase 5 consolida o ciclo financeiro das fases anteriores com dashboard real, relatórios, exportações privadas, gestão administrativa, configurações tipadas e painel separado de superadmin.

## Requisitos e configuração

- Node.js 22.12 ou superior e npm 10.8 ou superior.
- PostgreSQL 17.
- Redis 8.2 para fila, eventos distribuídos e heartbeat do worker.
- Docker Desktop com Docker Compose, quando disponível.

Copie `.env.example` para `.env`, defina uma senha local forte, atualize `DATABASE_URL`, informe `SEED_ADMIN_PASSWORD` e gere `PROVIDER_CREDENTIALS_ENCRYPTION_KEY` com exatamente 32 bytes em Base64. O PostgreSQL e o Redis são publicados apenas em `127.0.0.1`.

Para desenvolvimento seguro, mantenha `PAYMENT_PROVIDER_MODE=mock`. O modo `real` exige um Access Token configurado pela interface e nunca inclui credenciais no código. O fallback `WEBHOOK_LOCAL_FALLBACK=true` existe somente em desenvolvimento; em produção ele é proibido e a ausência do Redis deixa a aplicação indisponível para processamento assíncrono.

## Primeira execução

```powershell
npm install
docker compose up -d postgres redis
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Padrões: aplicação em `http://localhost:3000`, API em `http://localhost:3333`, readiness em `http://localhost:3333/health/ready` e métricas em `http://localhost:3333/health/metrics`. As portas podem ser alteradas no `.env`.

Execução completa em contêiner:

```powershell
docker compose --profile tools run --rm migrate
docker compose --profile tools run --rm seed
docker compose up -d api worker web
```

## Fluxo de confirmação

1. `POST /api/v1/webhooks/mercado-pago` preserva o corpo original, valida formato, deduplica o evento e confere `x-signature` com `x-request-id`, `data.id`, timestamp e segredo da empresa.
2. O endpoint responde sem executar a liquidação. O job leva apenas IDs seguros para a fila BullMQ `mercado-pago-webhooks`.
3. O worker e o fallback local chamam o mesmo `MercadoPagoWebhookProcessor`.
4. O processador usa o token cifrado da empresa e consulta `GET /v1/orders/{id}`. O status contido no webhook nunca confirma pagamento.
5. Order ID, payment ID, `external_reference`, moeda, ambiente e valor exato são conferidos.
6. Uma transação serializável cria `PixPayment`, atualiza cobrança e venda, cria `CashMovement` do tipo `PIX_PAYMENT`, registra histórico/auditoria e conclui o webhook.
7. O evento seguro é publicado no canal da empresa/cobrança. A tela usa SSE e troca para polling interno progressivo se a conexão cair.

A assinatura é HMAC-SHA256 comparada com `timingSafeEqual`. O timestamp tem tolerância configurável e eventos fora da janela são rejeitados contra replay. O segredo e o Access Token nunca são registrados.

## Idempotência e ordem de eventos

- Evento externo/fingerprint, pagamento por cobrança, `providerPaymentId` e origem do movimento possuem restrições únicas.
- `PAID` não volta para pendente, expirado, cancelado ou falho por evento atrasado.
- `REFUNDED` e `PARTIALLY_REFUNDED` não regridem automaticamente.
- Estados intermediários não movimentam caixa.
- Valor divergente gera `VALUE_MISMATCH`, alerta e auditoria, sem `PixPayment` ou crédito no caixa.
- Falhas transitórias usam tentativas e backoff exponencial; o limite gera `DEAD_LETTER` e notificação administrativa.

## Caixa, tempo real e histórico

O fechamento é bloqueado por padrão quando existem cobranças pendentes. Uma permissão administrativa permite exceção auditada. Se o pagamento chegar depois do fechamento, ele continua vinculado à sessão original, recalcula o valor esperado, marca ajuste pós-fechamento e cria um alerta; o caixa não é reaberto.

O SSE autenticado fica em `GET /api/v1/pix/charges/:publicId/events`, com isolamento multiempresa, heartbeat, reconexão, `Last-Event-ID`, limite por sessão e payload sanitizado. O fallback de interface consulta somente `GET /api/v1/pix/charges/:publicId`, pausa em aba inativa, aumenta o intervalo e encerra em status final.

O histórico possui busca, filtro de status, período, paginação no servidor e detalhe com status, impressões, webhooks e erros sanitizados. A reconciliação usa `POST /api/v1/pix/charges/:publicId/reconcile`, exige permissão e reutiliza todas as validações do webhook.

O comprovante confirmado gera `PrintJob` `PIX_PAYMENT_RECEIPT` e é explicitamente não fiscal. O reembolso está preparado no backend; `PIX_REFUND` somente é criado depois que a consulta ao provedor confirma o reembolso, nunca na solicitação.

## Endpoints da Fase 4

- `POST /api/v1/webhooks/mercado-pago`
- `GET /api/v1/pix/charges` e `GET /api/v1/pix/charges/:publicId/details`
- `GET /api/v1/pix/charges/:publicId/events`
- `POST /api/v1/pix/charges/:publicId/reconcile`
- `GET /api/v1/pix/payments/:publicId`
- `POST /api/v1/pix/payments/:publicId/receipt`
- `POST /api/v1/pix/payments/:publicId/refunds`
- `GET /api/v1/pix/refunds/:publicId`
- `GET /api/v1/pix/webhooks`
- `POST /api/v1/pix/webhooks/:publicId/reprocess`

As permissões correspondentes são aplicadas no backend: `pix.payment.read`, `pix.charge.reconcile`, `pix.webhook.read`, `pix.webhook.reprocess`, `pix.refund.create`, `pix.refund.read`, `pix.payment.receipt.print` e `cash.session.close.with_pending_charges`.

## Mercado Pago

Na conta Mercado Pago, cadastre uma notificação de Orders apontando para uma URL HTTPS pública terminada em `/api/v1/webhooks/mercado-pago`. Copie a assinatura secreta para a configuração da integração da empresa. Para testar localmente, exponha somente a API por um túnel HTTPS confiável e use a URL pública na configuração; nunca publique PostgreSQL ou Redis.

Documentação oficial consultada:

- [Webhooks e validação de assinatura](https://www.mercadopago.com.br/developers/en/docs/links-and-debts/additional-content/your-integrations/notifications/webhooks)
- [Orders API](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/overview)
- [Consultar uma Order](https://www.mercadopago.com.br/developers/pt/reference/in-person-payments/qr-code/orders/get-order/get)
- [Reembolsos e cancelamentos](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/refunds-cancellations)

## Testes e qualidade

Com o banco ativo e a migration aplicada:

```powershell
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Os testes cobrem autenticação, isolamento multiempresa, assinatura/replay, confirmação consultando o provider fake, idempotência financeira, evento fora de ordem, divergência de valor, pagamento e reembolso, fechamento pendente, ajuste pós-fechamento, comprovante, auditoria e publicação segura.

Usuários do seed: `admin@bitpix.local`, `operador@bitpix.local` e `superadmin@bitpix.local`, todos com a senha definida em `SEED_ADMIN_PASSWORD`. O E2E usa Microsoft Edge e espera API em `3333` e web em `E2E_BASE_URL` (padrão local atual: `http://localhost:3002`).

## Gestão e análise — Fase 5

- O dashboard agrega valores no backend com `Decimal`, período equivalente anterior, timezone da empresa, filtros validados e no máximo dez pagamentos recentes. Não depende de Redis e exibe estado vazio quando não há pagamentos.
- Relatórios de vendas, cobranças, pagamentos, sessões e movimentos de caixa e conciliação usam paginação no servidor. A conciliação apenas aponta inconsistências; nunca corrige registros silenciosamente.
- Exportações CSV, XLSX e PDF são jobs BullMQ. Em desenvolvimento sem Redis, o mesmo processador usa fallback local claramente degradado. Arquivos ficam em `.runtime/storage`, têm expiração, token temporário assinado, proteção contra fórmulas em CSV e notificação de conclusão ou falha.
- Usuários são desativados logicamente, têm funções e filial validadas no tenant e sessões revogáveis. Funções personalizadas não podem receber permissões `platform.*`; funções de sistema ou em uso não são removidas.
- Filiais têm identificação, timezone e endereço opcionais. A desativação é recusada enquanto existir caixa aberto. Os limites de usuários, filiais, caixas, cobranças mensais e exportações são verificados no backend.
- Configurações seguem a precedência plataforma → empresa → filial → usuário. O cupom Pix possui modelo tipado para 58/80 mm; logos aceitam apenas PNG, JPEG ou WebP com MIME mágico conferido, até 2 MB, nome aleatório e armazenamento controlado. SVG não é aceito.
- Auditoria possui filtros, detalhe sanitizado e `correlationId`. Notificações são separadas por empresa. A área `/plataforma` exige simultaneamente usuário marcado como superadmin e permissões de plataforma.

Endpoints principais adicionados:

- `GET /api/v1/dashboard/summary`, `/revenue`, `/status-distribution`, `/operators`, `/branches` e `/recent-payments`.
- `GET /api/v1/reports/{sales|payments|charges|cash-sessions|cash-movements|reconciliation}`.
- `POST /api/v1/reports/exports`, consulta do job e download privado temporário.
- CRUD seguro de `/users`, `/roles` e `/branches`, incluindo revogação de sessões e ativação/desativação.
- `/settings`, `/settings/effective`, `/preferences`, `/print-template` e upload de logo.
- `/audit`, `/notifications` e rotas separadas `/platform/*` para empresas, planos e saúde.

Permissões novas são agrupadas por `dashboard.*`, `reports.*`, `users.*`, `roles.*`, `branches.*`, `settings.*`, `print.settings.*`, `audit.*`, `notifications.*` e `platform.*`. Toda autorização relevante ocorre na API, independentemente da visibilidade do menu.

## Fase 6 — Infraestrutura e produção

Artefatos de produção adicionados (todos aditivos, sem alterar funcionalidades):

- Ambientes: `.env.example` (completo), `.env.development.example`, `.env.staging.example`, `.env.production.example`.
- Docker: `Dockerfile` endurecido (usuário `node`, `dumb-init`, `HEALTHCHECK`); overrides `docker-compose.staging.yml` (com MinIO) e `docker-compose.production.yml` (limites de CPU/memória, `no-new-privileges`, filesystem read-only, nginx, serviço de backup).
- Proxy: `deploy/nginx/bitpix.conf` + `bitpix.routes.inc` (SSE com buffering off, webhook com corpo original e IP real, HTTPS/HSTS prontos para habilitar).
- Observabilidade: `deploy/observability/prometheus.yml` e `alerts.yml` (info/warning/critical).
- Backup/DR: `scripts/backup.sh`, `restore.sh`, `verify-backup.sh` (pg_dump + AES-256 + S3 + retenção + verificação por restauração).
- Deploy/rollback: `scripts/deploy.sh`, `scripts/rollback.sh`.
- CI/CD: `.github/workflows/ci.yml` e `deploy.yml` (produção só com aprovação manual).

Documentação: [INSTALLATION](INSTALLATION.md) · [DEVELOPMENT](DEVELOPMENT.md) · [DEPLOYMENT](DEPLOYMENT.md) · [OPERATIONS](OPERATIONS.md) · [BACKUP_AND_RESTORE](BACKUP_AND_RESTORE.md) · [DISASTER_RECOVERY](DISASTER_RECOVERY.md) · [MERCADO_PAGO_HOMOLOGATION](MERCADO_PAGO_HOMOLOGATION.md) · [SECURITY](SECURITY.md) · [RUNBOOKS](RUNBOOKS.md) · [PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md) · [WSL_AND_DOCKER_SETUP](WSL_AND_DOCKER_SETUP.md).

> **Pendências que dependem de ambiente externo** (implementação pronta, ação manual necessária): instalar WSL2 + distro Ubuntu e reativar o engine do Docker Desktop (ver `WSL_AND_DOCKER_SETUP.md`); subir Redis + worker reais; credencial de teste do Mercado Pago para homologação; domínio, VPS e certificado TLS para produção.

## Limites atuais

- O modo real depende de credencial e conta Mercado Pago válidas; nenhum segredo real é incluído no projeto.
- A interface de solicitação de reembolso permanece desabilitada até haver homologação real da conta, embora modelo, permissões, serviço e confirmação financeira estejam preparados.
- Métricas são locais ao processo nesta fase; exportação Prometheus/OTel distribuída fica para uma fase de observabilidade.
- O sistema não emite NFC-e, NF-e ou qualquer documento fiscal.
