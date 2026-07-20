# Operações — BitPix

## Endpoints de saúde
| Endpoint | Uso |
|----------|-----|
| `GET /health/live` | Liveness (processo vivo) |
| `GET /health/ready` | Readiness: database, redis, worker, queue, storage. 503 se degradado |
| `GET /health/version` | Versão, commit, build, ambiente |
| `GET /health/metrics` | Métricas Prometheus |
| `GET /health/metrics.json` | Snapshot JSON |

`ready` só retorna `200/ready` quando **todas** as dependências estão saudáveis. Em produção, Redis e worker são obrigatórios.

## Observabilidade
- Prometheus: `deploy/observability/prometheus.yml` (scrape em `api:3333/health/metrics`).
- Alertas: `deploy/observability/alerts.yml` (info/warning/critical).
- Logs estruturados JSON no worker; a API emite logs do Fastify e correlationId por requisição.
- Métricas expostas incluem: `bitpix_http_requests_total`, `bitpix_http_request_duration_seconds`, `bitpix_dependency_health{dependency}`, `bitpix_pending_charges_old` e métricas de pagamento/webhook.

> Nunca logar Access Token, cookies, Pix Copia e Cola, QR Code, senhas ou dados pessoais desnecessários.

## Alertas (severidade)
- **critical**: API/DB/Redis/worker offline, erro 5xx > 5%.
- **warning**: fila acumulada, cobranças pendentes antigas, latência p95 alta.
- **info**: eventos informativos de rotina.

## Filas (worker)
- `mercado-pago-webhooks`: confirma pagamentos. Retry `WEBHOOK_MAX_ATTEMPTS`, backoff exponencial, dead-letter (retenção 14 dias).
- `report-exports`: exportações CSV/XLSX/PDF.
- `bitpix-maintenance`: poda de sessões expiradas (a cada 1h).

Heartbeat em `bitpix:worker:heartbeat` (TTL 30s). Contagens em `bitpix:worker:webhook-counts`/`export-counts`.

## Tarefas rotineiras
- Backup diário: `scripts/backup.sh` (agende via cron do host, ver `BACKUP_AND_RESTORE.md`).
- Verificação de backup semanal: `scripts/verify-backup.sh`.
- Revisar dead-letter e cobranças pendentes antigas.
- Conferir readiness e métricas.

## Portas locais atuais (referência)
Postgres 5433/5434, Redis 6380, API 3333, Web 3000/3002.
