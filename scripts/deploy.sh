#!/usr/bin/env bash
# =====================================================================
# BitPix — deploy seguro (staging/produção)
# Fluxo: valida ambiente -> git -> backup -> build -> testes essenciais
#        -> migrations -> redis/worker -> api -> web -> health -> smoke.
# NÃO apaga volumes. NÃO roda seed de desenvolvimento.
# Uso: ENVIRONMENT=production ./scripts/deploy.sh
# =====================================================================
set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-staging}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f docker-compose.yml -f "docker-compose.${ENVIRONMENT}.yml")

log() { printf '\033[1;34m[deploy:%s]\033[0m %s\n' "$ENVIRONMENT" "$1"; }
fail() { printf '\033[1;31m[deploy:%s] ERRO:\033[0m %s\n' "$ENVIRONMENT" "$1" >&2; exit 1; }

[ -f "docker-compose.${ENVIRONMENT}.yml" ] || fail "override de compose inexistente para ${ENVIRONMENT}"
[ -f ".env" ] || fail ".env ausente (copie de .env.${ENVIRONMENT}.example e preencha os segredos)"

log "1/14 Validando configuração de ambiente"
"${COMPOSE[@]}" config --quiet || fail "docker compose config inválido"

log "2/14 Verificando estado do Git"
if command -v git >/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
  git rev-parse --short HEAD || true
  [ -z "$(git status --porcelain)" ] || log "AVISO: há alterações não commitadas"
else
  log "AVISO: diretório não é repositório Git — sem rastreabilidade de versão"
fi

log "3/14 Backup do banco ANTES de qualquer migration"
"${COMPOSE[@]}" ps postgres >/dev/null 2>&1 && \
  "${COMPOSE[@]}" exec -T postgres sh -c 'command -v pg_dump >/dev/null' && \
  "${COMPOSE[@]}" run --rm -T backup /scripts/backup.sh || log "AVISO: backup pré-deploy não executado (primeiro deploy?)"

log "4/14 Construindo imagens"
"${COMPOSE[@]}" build

log "5/14 Testes essenciais (lint + typecheck + unit)"
npm run lint && npm run typecheck && npm run test || fail "testes essenciais falharam — deploy abortado"

log "6/14 Aplicando migrations (não destrutivas)"
"${COMPOSE[@]}" --profile tools run --rm migrate || fail "migrations falharam"

log "7/14 Subindo Postgres e Redis"
"${COMPOSE[@]}" up -d postgres redis

log "8/14 Subindo worker"
"${COMPOSE[@]}" up -d worker

log "9/14 Subindo API"
"${COMPOSE[@]}" up -d api

log "10/14 Subindo web e proxy"
"${COMPOSE[@]}" up -d web
"${COMPOSE[@]}" ps proxy >/dev/null 2>&1 && "${COMPOSE[@]}" up -d proxy || true

log "11/14 Aguardando health da API"
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T api wget -q -O- http://localhost:3333/health/ready | grep -q '"status":"ready"'; then
    log "readiness OK"; break
  fi
  [ "$i" -eq 30 ] && fail "readiness não atingiu 'ready' (Redis/worker indisponíveis?)"
  sleep 3
done

log "12/14 Smoke test: /health/live e /health/version"
"${COMPOSE[@]}" exec -T api wget -q -O- http://localhost:3333/health/live | grep -q '"status":"ok"' || fail "live falhou"
"${COMPOSE[@]}" exec -T api wget -q -O- http://localhost:3333/health/version | grep -q '"service":"bitpix-api"' || fail "version falhou"

log "13/14 Smoke test: página de login servida pelo web"
"${COMPOSE[@]}" exec -T web wget -q --spider http://localhost:3000/login || fail "web /login falhou"

log "14/14 Deploy concluído com sucesso"
"${COMPOSE[@]}" ps
