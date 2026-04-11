#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-${LA_DATA_ROOT:-/data/localagent}}"
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
POSTGRES_UID="${POSTGRES_UID:-70}"
POSTGRES_GID="${POSTGRES_GID:-70}"
REDIS_UID="${REDIS_UID:-999}"
REDIS_GID="${REDIS_GID:-1000}"

mkdir -p \
  "$ROOT/platform/db/primary" \
  "$ROOT/platform/backups/postgres" \
  "$ROOT/platform/redis/data" \
  "$ROOT/platform/minio/data" \
  "$ROOT/platform/proxy/acme" \
  "$ROOT/platform/proxy/extra-ca" \
  "$ROOT/platform/proxy/traefik" \
  "$ROOT/platform/proxy/traefik/ca" \
  "$ROOT/platform/proxy/traefik/certs" \
  "$ROOT/platform/logs/postgres" \
  "$ROOT/platform/logs/redis" \
  "$ROOT/platform/logs/minio" \
  "$ROOT/platform/logs/traefik" \
  "$ROOT/apps/omniroute/data" \
  "$ROOT/apps/omniroute/logs" \
  "$ROOT/apps/open-webui/runtime" \
  "$ROOT/apps/openclaw/config" \
  "$ROOT/apps/openclaw/workspace"

if [[ "$(id -u)" == "0" ]]; then
  chown -R "$POSTGRES_UID:$POSTGRES_GID" "$ROOT/platform/db/primary" "$ROOT/platform/logs/postgres"
  chown -R "$REDIS_UID:$REDIS_GID" "$ROOT/platform/redis/data" "$ROOT/platform/logs/redis"
  chown -R "$APP_UID:$APP_GID" "$ROOT/apps/openclaw" "$ROOT/apps/open-webui" "$ROOT/apps/omniroute"
else
  echo "NOTE: not running as root; skipping chown."
fi
chmod 700 "$ROOT/platform/proxy/acme"
touch "$ROOT/platform/proxy/extra-ca/extra-ca.pem"
chmod 644 "$ROOT/platform/proxy/extra-ca/extra-ca.pem"

echo "Prepared data directories under $ROOT"
