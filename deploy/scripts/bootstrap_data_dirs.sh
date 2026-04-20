#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-${LA_DATA_ROOT:-/data/localagent}}"
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
POSTGRES_UID="${POSTGRES_UID:-70}"
POSTGRES_GID="${POSTGRES_GID:-70}"
REDIS_UID="${REDIS_UID:-999}"
REDIS_GID="${REDIS_GID:-1000}"
BOOTSTRAP_WITH_DOCKER="${BOOTSTRAP_WITH_DOCKER:-auto}"
BOOTSTRAP_HELPER_IMAGE="${BOOTSTRAP_HELPER_IMAGE:-alpine:3.20}"

DATA_DIRS=(
  "$ROOT/platform/db/primary"
  "$ROOT/platform/backups/postgres"
  "$ROOT/platform/redis/data"
  "$ROOT/platform/minio/data"
  "$ROOT/platform/proxy/acme"
  "$ROOT/platform/proxy/extra-ca"
  "$ROOT/platform/proxy/traefik"
  "$ROOT/platform/proxy/traefik/ca"
  "$ROOT/platform/proxy/traefik/certs"
  "$ROOT/platform/logs/postgres"
  "$ROOT/platform/logs/redis"
  "$ROOT/platform/logs/minio"
  "$ROOT/platform/logs/traefik"
  "$ROOT/apps/omniroute/data"
  "$ROOT/apps/omniroute/logs"
  "$ROOT/apps/open-webui/runtime"
  "$ROOT/apps/openclaw/config"
  "$ROOT/apps/openclaw/workspace"
)

USER_WRITABLE_DIRS=(
  "$ROOT/platform/proxy/acme"
  "$ROOT/platform/proxy/extra-ca"
  "$ROOT/platform/proxy/traefik"
  "$ROOT/apps/openclaw/config"
  "$ROOT/apps/openclaw/workspace"
  "$ROOT/apps/open-webui/runtime"
  "$ROOT/apps/omniroute/data"
  "$ROOT/apps/omniroute/logs"
)

create_dirs_native() {
  mkdir -p "${DATA_DIRS[@]}"
}

can_finalize_native() {
  if [[ "$(id -u)" == "0" ]]; then
    return 0
  fi

  local dir
  for dir in "${USER_WRITABLE_DIRS[@]}"; do
    if [[ ! -w "$dir" ]]; then
      return 1
    fi
  done

  local extra_ca_file="$ROOT/platform/proxy/extra-ca/extra-ca.pem"
  if [[ -e "$extra_ca_file" && ! -w "$extra_ca_file" ]]; then
    return 1
  fi
}

finalize_native() {
  if [[ "$(id -u)" == "0" ]]; then
    chown -R "$POSTGRES_UID:$POSTGRES_GID" "$ROOT/platform/db/primary" "$ROOT/platform/logs/postgres"
    chown -R "$REDIS_UID:$REDIS_GID" "$ROOT/platform/redis/data" "$ROOT/platform/logs/redis"
    chown -R "$APP_UID:$APP_GID" \
      "$ROOT/apps/openclaw" \
      "$ROOT/apps/open-webui" \
      "$ROOT/apps/omniroute" \
      "$ROOT/platform/proxy/extra-ca" \
      "$ROOT/platform/proxy/traefik"
  else
    echo "NOTE: not running as root; skipping chown."
  fi
  chmod 700 "$ROOT/platform/proxy/acme"
  touch "$ROOT/platform/proxy/extra-ca/extra-ca.pem"
  chmod 644 "$ROOT/platform/proxy/extra-ca/extra-ca.pem"
  if [[ "$(id -u)" == "0" ]]; then
    chown "$APP_UID:$APP_GID" "$ROOT/platform/proxy/extra-ca/extra-ca.pem"
  fi
}

bootstrap_with_docker() {
  if [[ "$BOOTSTRAP_WITH_DOCKER" == "never" ]]; then
    return 1
  fi
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi
  if ! docker info >/dev/null 2>&1; then
    return 1
  fi

  echo "Native directory bootstrap cannot finalize $ROOT; using Docker root helper ($BOOTSTRAP_HELPER_IMAGE)."
  docker run --rm \
    -e APP_UID="$APP_UID" \
    -e APP_GID="$APP_GID" \
    -e POSTGRES_UID="$POSTGRES_UID" \
    -e POSTGRES_GID="$POSTGRES_GID" \
    -e REDIS_UID="$REDIS_UID" \
    -e REDIS_GID="$REDIS_GID" \
    -v "$ROOT:/la-root" \
    "$BOOTSTRAP_HELPER_IMAGE" \
    sh -eu -c '
      mkdir -p \
        /la-root/platform/db/primary \
        /la-root/platform/backups/postgres \
        /la-root/platform/redis/data \
        /la-root/platform/minio/data \
        /la-root/platform/proxy/acme \
        /la-root/platform/proxy/extra-ca \
        /la-root/platform/proxy/traefik \
        /la-root/platform/proxy/traefik/ca \
        /la-root/platform/proxy/traefik/certs \
        /la-root/platform/logs/postgres \
        /la-root/platform/logs/redis \
        /la-root/platform/logs/minio \
        /la-root/platform/logs/traefik \
        /la-root/apps/omniroute/data \
        /la-root/apps/omniroute/logs \
        /la-root/apps/open-webui/runtime \
        /la-root/apps/openclaw/config \
        /la-root/apps/openclaw/workspace

      chown -R "$POSTGRES_UID:$POSTGRES_GID" /la-root/platform/db/primary /la-root/platform/logs/postgres
      chown -R "$REDIS_UID:$REDIS_GID" /la-root/platform/redis/data /la-root/platform/logs/redis
      chown -R "$APP_UID:$APP_GID" \
        /la-root/apps/openclaw \
        /la-root/apps/open-webui \
        /la-root/apps/omniroute \
        /la-root/platform/proxy/extra-ca \
        /la-root/platform/proxy/traefik
      chmod 700 /la-root/platform/proxy/acme
      touch /la-root/platform/proxy/extra-ca/extra-ca.pem
      chmod 644 /la-root/platform/proxy/extra-ca/extra-ca.pem
      chown "$APP_UID:$APP_GID" /la-root/platform/proxy/extra-ca/extra-ca.pem
    '
}

if create_dirs_native && can_finalize_native; then
  finalize_native
elif ! bootstrap_with_docker; then
  echo "ERROR: Cannot prepare $ROOT with current user and Docker root helper is unavailable." >&2
  echo "Run as root/sudo, change ownership of $ROOT, or set LA_DATA_ROOT to a writable path." >&2
  exit 1
fi

echo "Prepared data directories under $ROOT"
