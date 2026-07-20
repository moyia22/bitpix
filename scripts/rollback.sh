#!/usr/bin/env bash
# =====================================================================
# BitPix — rollback de aplicação (API, worker, web, proxy)
# Volta os serviços para uma tag de imagem anterior conhecida.
# NÃO reverte migrations automaticamente (schema segue expand/contract).
# Para rollback lógico de dados: restaure um backup com scripts/restore.sh
# em uma janela planejada. Ver DISASTER_RECOVERY.md.
# Uso: ENVIRONMENT=production IMAGE_TAG=<sha_anterior> ./scripts/rollback.sh
# =====================================================================
set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-staging}"
IMAGE_TAG="${IMAGE_TAG:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f docker-compose.yml -f "docker-compose.${ENVIRONMENT}.yml")

log() { printf '\033[1;33m[rollback:%s]\033[0m %s\n' "$ENVIRONMENT" "$1"; }
fail() { printf '\033[1;31m[rollback:%s] ERRO:\033[0m %s\n' "$ENVIRONMENT" "$1" >&2; exit 1; }

[ -n "$IMAGE_TAG" ] || fail "informe IMAGE_TAG (tag/sha da imagem anterior estável)"

log "Registre o motivo do rollback e avise a equipe antes de prosseguir."
log "1/5 Fixando tag de imagem: ${IMAGE_TAG}"
export BITPIX_IMAGE_TAG="$IMAGE_TAG"

log "2/5 AVISO: NÃO revertendo migrations. Confirme compatibilidade do schema (expand/contract)."

log "3/5 Recriando serviços de aplicação com a imagem anterior"
"${COMPOSE[@]}" up -d --no-deps worker api web
"${COMPOSE[@]}" ps proxy >/dev/null 2>&1 && "${COMPOSE[@]}" up -d --no-deps proxy || true

log "4/5 Validando health da API após rollback"
for i in $(seq 1 20); do
  if "${COMPOSE[@]}" exec -T api wget -q -O- http://localhost:3333/health/ready | grep -q '"status":"ready"'; then
    log "readiness OK"; break
  fi
  [ "$i" -eq 20 ] && fail "readiness não OK após rollback — escale para incidente (ver RUNBOOKS.md)"
  sleep 3
done

log "5/5 Rollback concluído. Monitore métricas e logs por 30 minutos."
"${COMPOSE[@]}" ps
