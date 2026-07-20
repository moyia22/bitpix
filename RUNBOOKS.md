# Runbooks — BitPix

Procedimentos para incidentes comuns. Sempre registrar linha do tempo.

## readiness = 503 (degraded)
1. `curl -s http://localhost:3333/health/ready` → ver qual check falhou.
2. **database=false**: Postgres caiu → ver logs do container `postgres`; reiniciar; conferir disco.
3. **redis=false**: Redis caiu → reiniciar `redis`; conferir `REDIS_URL`/senha.
4. **worker=false**: sem heartbeat → ver logs do `worker`; reiniciar; confirmar conexão Redis.
5. **queue=false**: muitos jobs falhos → inspecionar dead-letter (abaixo).
6. **storage=false**: S3/local inacessível → conferir credenciais/bucket/permissões.

## Worker offline
- Sintoma: `bitpix_dependency_health{dependency="worker"}=0`, webhooks/exportações parados.
- Ação: `docker compose ... up -d worker`; ver logs; confirmar heartbeat em Redis (`bitpix:worker:heartbeat`).
- Em produção, readiness deve permanecer 503 até o worker voltar (correto).

## Fila acumulando / dead-letter
- Inspecionar contagens: `bitpix:worker:webhook-counts` / `export-counts`.
- Webhooks falhos: reprocessar `POST /api/v1/pix/webhooks/:publicId/reprocess`.
- Investigar causa (token inválido? provedor fora? valor divergente?).

## Webhook do Mercado Pago falhando
1. Confirmar URL pública HTTPS ativa e alcançável.
2. Conferir assinatura secreta configurada por empresa.
3. `VALUE_MISMATCH`: valor divergente → não credita caixa; alerta + auditoria. Investigar cobrança.
4. Ver `WebhookEvent`/`WebhookAttempt` no banco.

## Pagamento após fechamento do caixa
- Comportamento esperado: pagamento fica vinculado à sessão original, recalcula esperado, marca ajuste pós-fechamento, gera alerta; **não reabre** o caixa.
- Ação: revisar o alerta e o histórico; reconciliar se necessário.

## Token do Mercado Pago inválido
- Alerta de token inválido → renovar Access Token na interface da empresa.
- Confirmar que segredos não vazaram em logs.

## Backup falhou
- Ver `/var/log/bitpix-backup.log`.
- Rodar manualmente `scripts/backup.sh`; conferir passphrase, credenciais S3 e espaço em disco.
- Validar com `scripts/verify-backup.sh`.

## Disco cheio
- Rotacionar logs (já limitados a 10m x5 no compose de produção).
- Limpar `.runtime/storage` temporários expirados; conferir volume do Postgres.

## Suspeita de acesso indevido
1. Revogar sessões do usuário afetado.
2. Forçar reset de senha; exigir MFA.
3. Revisar `AuditLog` por `correlationId`/IP.

## Escalonamento
- critical: acionar on-call imediatamente.
- warning: tratar no horário comercial se não escalar.
