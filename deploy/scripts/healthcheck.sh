#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"

mode="${1:-local}" # local|server (same behavior; kept for readability)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

HEALTHCHECK_TIMEOUT_SECONDS="${HEALTHCHECK_TIMEOUT_SECONDS:-0}"
HEALTHCHECK_INTERVAL_SECONDS="${HEALTHCHECK_INTERVAL_SECONDS:-5}"

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

OMNIROUTE_HOST="$(read_env_value OMNIROUTE_HOST || echo router.localagent.local)"
OPENWEBUI_HOST="$(read_env_value OPENWEBUI_HOST || echo chat.localagent.local)"
OPENCLAW_HOST="$(read_env_value OPENCLAW_HOST || echo openclaw.localagent.local)"
MINIO_CONSOLE_HOST="$(read_env_value MINIO_CONSOLE_HOST || echo minio.localagent.local)"
MINIO_API_HOST="$(read_env_value MINIO_API_HOST || echo s3.localagent.local)"
TRAEFIK_TLS_ENABLED="$(read_env_value TRAEFIK_TLS_ENABLED || echo true)"
TRAEFIK_HTTP_PORT="$(read_env_value TRAEFIK_HTTP_PORT || echo 80)"
TRAEFIK_HTTPS_PORT="$(read_env_value TRAEFIK_HTTPS_PORT || echo 443)"

BASE_URL="${BASE_URL:-http://127.0.0.1}"

normalize_bool() {
  case "${1:-}" in
    1|true|TRUE|True|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

check_once() {
  local fail=0

  check() {
    local name="$1"
    local host="$2"
    local path="$3"
    local expect_regex="$4"
    local code
    if normalize_bool "$TRAEFIK_TLS_ENABLED"; then
      code="$(
        curl -sS -k -o /dev/null -w "%{http_code}" \
          --resolve "${host}:${TRAEFIK_HTTPS_PORT}:127.0.0.1" \
          "https://${host}:${TRAEFIK_HTTPS_PORT}${path}" || true
      )"
    else
      code="$(curl -sS -o /dev/null -w "%{http_code}" -H "Host: $host" "$BASE_URL$path" || true)"
    fi
    if [[ ! "$code" =~ $expect_regex ]]; then
      echo "FAIL $name host=$host path=$path code=$code expected=$expect_regex"
      fail=1
    else
      echo "OK   $name code=$code"
    fi
  }

  if normalize_bool "$TRAEFIK_TLS_ENABLED"; then
    echo "Healthcheck mode=$mode base=https://<host>:${TRAEFIK_HTTPS_PORT} (resolve -> 127.0.0.1, insecure CA allowed)"
  else
    echo "Healthcheck mode=$mode base=$BASE_URL"
  fi
  check "openwebui" "$OPENWEBUI_HOST" "/" "^(200|30[12])$"
  check "omniroute" "$OMNIROUTE_HOST" "/" "^(200|30[12]|307)$"
  check "openclaw" "$OPENCLAW_HOST" "/healthz" "^(200)$"
  check "minio-console" "$MINIO_CONSOLE_HOST" "/" "^(200|30[12])$"
  check "minio-api" "$MINIO_API_HOST" "/" "^(200|30[12]|403)$"

  return "$fail"
}

if [[ "$HEALTHCHECK_TIMEOUT_SECONDS" == "0" ]]; then
  check_once
  exit $?
fi

start_ts="$(date +%s)"
until check_once; do
  now_ts="$(date +%s)"
  elapsed="$((now_ts - start_ts))"
  if (( elapsed >= HEALTHCHECK_TIMEOUT_SECONDS )); then
    echo "Healthcheck timed out after ${HEALTHCHECK_TIMEOUT_SECONDS}s"
    exit 1
  fi
  echo "Retrying in ${HEALTHCHECK_INTERVAL_SECONDS}s... (elapsed ${elapsed}s)"
  sleep "$HEALTHCHECK_INTERVAL_SECONDS"
done

exit 0
