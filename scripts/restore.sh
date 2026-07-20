#!/usr/bin/env sh
# =====================================================================
# BitPix — restauração do PostgreSQL a partir de um backup criptografado
# Uso: restore.sh <arquivo.sql.gz.gpg | s3://bucket/chave>
# Requer confirmação explícita (RESTORE_CONFIRM=yes) — operação destrutiva.
# NUNCA execute contra o banco de produção sem uma janela planejada.
# =====================================================================
set -eu

log() { printf '{"level":"%s","component":"restore","message":"%s","ts":"%s"}\n' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; }
fail() { log "error" "$1"; exit 1; }

SRC="${1:-}"
[ -n "$SRC" ] || fail "informe o arquivo de backup (local ou s3://...)"
: "${PGDATABASE:?defina PGDATABASE}"
: "${PGUSER:?defina PGUSER}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?defina BACKUP_ENCRYPTION_PASSPHRASE}"

if [ "${RESTORE_CONFIRM:-no}" != "yes" ]; then
  fail "operação destrutiva. Reexecute com RESTORE_CONFIRM=yes para confirmar."
fi

WORKDIR="${BACKUP_WORKDIR:-/tmp}"
LOCAL="${WORKDIR}/restore_source.sql.gz.gpg"

case "$SRC" in
  s3://*)
    export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:-}"
    export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:-}"
    ENDPOINT_ARG=""
    [ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT_ARG="--endpoint-url ${BACKUP_S3_ENDPOINT}"
    # shellcheck disable=SC2086
    aws $ENDPOINT_ARG s3 cp "$SRC" "$LOCAL" || fail "download S3 falhou"
    ;;
  *)
    [ -f "$SRC" ] || fail "arquivo local não encontrado: $SRC"
    cp "$SRC" "$LOCAL"
    ;;
esac

log "info" "descriptografando e restaurando em ${PGDATABASE}"
gpg --batch --yes --decrypt --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" "$LOCAL" \
  | gunzip \
  | psql --set ON_ERROR_STOP=on "$PGDATABASE" \
  || fail "restauração falhou"

rm -f "$LOCAL"
log "info" "restauração concluída com sucesso"
