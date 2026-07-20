#!/usr/bin/env sh
# =====================================================================
# BitPix — verificação de backup por RESTAURAÇÃO REAL
# Um backup só é considerado válido depois de restaurado com sucesso
# em um banco temporário descartável e checado.
# Uso: verify-backup.sh <arquivo.sql.gz.gpg | s3://bucket/chave>
# Requer: gpg, gunzip, psql, createdb, dropdb.
# =====================================================================
set -eu

log() { printf '{"level":"%s","component":"verify-backup","message":"%s","ts":"%s"}\n' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; }
fail() { log "error" "$1"; exit 1; }

SRC="${1:-}"
[ -n "$SRC" ] || fail "informe o arquivo de backup (local ou s3://...)"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?defina BACKUP_ENCRYPTION_PASSPHRASE}"
VERIFY_DB="bitpix_verify_$(date -u +%s)"
WORKDIR="${BACKUP_WORKDIR:-/tmp}"
LOCAL="${WORKDIR}/verify_source.sql.gz.gpg"

case "$SRC" in
  s3://*)
    export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:-}"
    export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:-}"
    ENDPOINT_ARG=""
    [ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT_ARG="--endpoint-url ${BACKUP_S3_ENDPOINT}"
    # shellcheck disable=SC2086
    aws $ENDPOINT_ARG s3 cp "$SRC" "$LOCAL" || fail "download S3 falhou"
    ;;
  *) [ -f "$SRC" ] || fail "arquivo não encontrado: $SRC"; cp "$SRC" "$LOCAL" ;;
esac

cleanup() { dropdb --if-exists "$VERIFY_DB" >/dev/null 2>&1 || true; rm -f "$LOCAL"; }
trap cleanup EXIT

log "info" "criando banco temporário ${VERIFY_DB}"
createdb "$VERIFY_DB" || fail "createdb falhou"

log "info" "restaurando backup no banco temporário"
gpg --batch --yes --decrypt --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" "$LOCAL" \
  | gunzip \
  | psql --set ON_ERROR_STOP=on "$VERIFY_DB" >/dev/null \
  || fail "restauração de verificação falhou"

# Sanity check: existência de tabelas essenciais e contagem de usuários.
TABLES="$(psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" "$VERIFY_DB")"
[ "${TABLES:-0}" -gt 10 ] || fail "backup restaurado com poucas tabelas (${TABLES}) — suspeito"
log "info" "verificação OK: ${TABLES} tabelas restauradas com sucesso"
