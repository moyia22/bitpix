# Recuperação de Desastres — BitPix

## Objetivos (definir com o negócio)
- **RPO** (perda máxima de dados): ex. 24h (backup diário) — reduza com backups mais frequentes/WAL.
- **RTO** (tempo máximo de indisponibilidade): ex. 2h.

## Cenários

### 1. Perda total do servidor de aplicação
1. Provisionar novo host (Docker + Compose).
2. Restaurar `.env` de produção do secret manager.
3. `git clone` da tag de release em produção.
4. `docker compose -f docker-compose.yml -f docker-compose.production.yml build`.
5. Restaurar banco: `RESTORE_CONFIRM=yes ./scripts/restore.sh s3://...` (backup mais recente verificado).
6. Subir: `ENVIRONMENT=production ./scripts/deploy.sh` (pula seed).
7. Validar readiness, login, SSE, webhook.

### 2. Corrupção/erro de dados
1. Identificar o instante seguro.
2. Restaurar o backup imediatamente anterior em um banco **paralelo**.
3. Comparar/extrair os dados corretos; aplicar correção pontual. Evitar sobrescrever o banco vivo inteiro se possível.

### 3. Migration problemática
- O schema segue **expand/contract**: mudanças novas são compatíveis com a versão anterior do código.
- Rollback de código: `scripts/rollback.sh` com a imagem anterior (o schema novo continua compatível).
- **Não** reverter migration destrutiva automaticamente. Se necessário, restaurar do backup pré-deploy (o `deploy.sh` faz backup antes das migrations).

### 4. Redis perdido
- Redis é volátil para jobs em andamento, mas os dados financeiros estão no Postgres (fonte da verdade).
- Reprocessar webhooks pendentes via `POST /api/v1/pix/webhooks/:publicId/reprocess` ou reconciliação `POST /api/v1/pix/charges/:publicId/reconcile`.

## Rollback de aplicação
```bash
ENVIRONMENT=production IMAGE_TAG=<sha_estável_anterior> ./scripts/rollback.sh
```

## Pós-incidente
- Registrar linha do tempo e causa raiz.
- Confirmar integridade financeira (reconciliação).
- Revisar alertas que dispararam (ou deveriam ter disparado).
