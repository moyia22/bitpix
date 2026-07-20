#!/usr/bin/env sh
# =====================================================================
# BitPix — backup do PostgreSQL
# pg_dump -> gzip -> criptografia AES-256 (gpg) -> upload S3 -> retenção
# Requer: pg_dump, gzip, gpg, aws-cli (para upload).
# Variáveis: PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
#            BACKUP_ENCRYPTION_PASSPHRASE
#            BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY
#            BACKUP_RETENTION_DAYS (padrão 30)
# Saída/estado é registrado em JSON no stdout (para observabilidade).
# =====================================================================
set -eu

log() { printf '{"level":"%s","component":"backup","message":"%s","ts":"%s"}\n' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; }
fail() { log "error" "$1"; exit 1; }

: "${PGDATABASE:?defina PGDATABASE}"
: "${PGUSER:?defina PGUSER}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?defina BACKUP_ENCRYPTION_PASSPHRASE}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
WORKDIR="${BACKUP_WORKDIR:-/backups}"
mkdir -p "$WORKDIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="bitpix_${PGDATABASE}_${STAMP}.sql.gz.gpg"
OUT="${WORKDIR}/${BASENAME}"

log "info" "iniciando pg_dump de ${PGDATABASE}"
# --no-owner/--no-privileges facilita restauração em ambiente diferente.
pg_dump --format=plain --no-owner --no-privileges "$PGDATABASE" \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
        --output "$OUT" \
  || fail "pg_dump/criptografia falhou"

SIZE="$(wc -c < "$OUT" | tr -d ' ')"
[ "$SIZE" -gt 0 ] || fail "arquivo de backup vazio"
sha256sum "$OUT" > "${OUT}.sha256" 2>/dev/null || shasum -a 256 "$OUT" > "${OUT}.sha256"
log "info" "backup local criado: ${BASENAME} (${SIZE} bytes)"

# Upload para S3 (bucket privado, idealmente em outro provedor/servidor).
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:-}"
  export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:-}"
  ENDPOINT_ARG=""
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT_ARG="--endpoint-url ${BACKUP_S3_ENDPOINT}"
  # shellcheck disable=SC2086
  aws $ENDPOINT_ARG s3 cp "$OUT" "s3://${BACKUP_S3_BUCKET}/${BASENAME}" --sse AES256 || fail "upload S3 falhou"
  # shellcheck disable=SC2086
  aws $ENDPOINT_ARG s3 cp "${OUT}.sha256" "s3://${BACKUP_S3_BUCKET}/${BASENAME}.sha256" || fail "upload checksum falhou"
  log "info" "upload S3 concluído: s3://${BACKUP_S3_BUCKET}/${BASENAME}"

  # Retenção: remove objetos mais antigos que RETENTION_DAYS.
  CUTOFF="$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%dT%H%M%SZ 2>/dev/null || date -u -v-"${RETENTION_DAYS}"d +%Y%m%dT%H%M%SZ)"
  # shellcheck disable=SC2086
  aws $ENDPOINT_ARG s3 ls "s3://${BACKUP_S3_BUCKET}/" | awk '{print $4}' | grep '^bitpix_' | while read -r KEY; do
    OBJSTAMP="$(printf '%s' "$KEY" | sed -n 's/.*_\([0-9T]*Z\)\.sql.*/\1/p')"
    [ -z "$OBJSTAMP" ] && continue
    if [ "$OBJSTAMP" \< "$CUTOFF" ]; then
      # shellcheck disable=SC2086
      aws $ENDPOINT_ARG s3 rm "s3://${BACKUP_S3_BUCKET}/${KEY}" && log "info" "retenção: removido ${KEY}"
    fi
  done
else
  log "warning" "BACKUP_S3_BUCKET não definido — backup ficou apenas local (NÃO recomendado em produção)"
fi

# Limpeza local (mantém só o mais recente localmente).
find "$WORKDIR" -name 'bitpix_*.sql.gz.gpg' -type f 2>/dev/null | sort | head -n -1 | while read -r OLD; do rm -f "$OLD" "${OLD}.sha256"; done

log "info" "backup concluído com sucesso"
