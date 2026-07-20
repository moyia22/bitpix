#!/usr/bin/env bash
# =====================================================================
# BitPix — Redis local para desenvolvimento no Windows (sem Docker)
# Usa a build redis-windows extraída em .runtime/redis (gitignorada).
# Sobe o redis-server na porta 6380 (mesma do .env de desenvolvimento).
# Para o stack completo local: rode este script e, em outro terminal,
#   npm --workspace @bitpix/worker run start   (ou run dev)
#   npm run dev                                 (web + api)
# Assim /health/ready fica "ready".
# =====================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REDIS_DIR="$ROOT/.runtime/redis/Redis-8.8.0-Windows-x64-msys2"
PORT="${REDIS_PORT:-6380}"

if [ ! -x "$REDIS_DIR/redis-server.exe" ]; then
  echo "redis-server não encontrado em $REDIS_DIR" >&2
  echo "Baixe a release em https://github.com/redis-windows/redis-windows/releases e extraia em .runtime/redis/" >&2
  exit 1
fi

echo "Iniciando Redis em 127.0.0.1:${PORT} (Ctrl+C para parar)"
exec "$REDIS_DIR/redis-server.exe" \
  --port "$PORT" --bind 127.0.0.1 \
  --appendonly no --save "" \
  --dir "$ROOT/.runtime/redis"
