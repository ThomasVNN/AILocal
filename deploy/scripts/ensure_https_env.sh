#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-${ENV_FILE:-}}"
if [[ -z "$ENV_FILE" ]]; then
  echo "Usage: $0 /path/to/stack.env" >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

env_set() {
  local key="$1"
  local value="$2"
  local tmp_file
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/localagent-env.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN {
      prefix = key "="
      replaced = 0
    }
    index($0, prefix) == 1 && replaced == 0 {
      print prefix value
      replaced = 1
      next
    }
    { print }
    END {
      if (replaced == 0) {
        print prefix value
      }
    }
  ' "$ENV_FILE" > "$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
}

omniroute_host="$(read_env_value OMNIROUTE_HOST || true)"
if [[ -z "$omniroute_host" ]]; then
  omniroute_host="router.localagent.local"
fi
https_port="$(read_env_value TRAEFIK_HTTPS_PORT || echo 443)"
if [[ "$https_port" == "443" ]]; then
  public_suffix=""
else
  public_suffix=":$https_port"
fi

env_set "TRAEFIK_TLS_ENABLED" "true"
env_set "TRAEFIK_HTTP_PORT" "$(read_env_value TRAEFIK_HTTP_PORT || echo 80)"
env_set "TRAEFIK_HTTPS_PORT" "$(read_env_value TRAEFIK_HTTPS_PORT || echo 443)"
env_set "TRAEFIK_HSTS_SECONDS" "$(read_env_value TRAEFIK_HSTS_SECONDS || echo 0)"
env_set "TRAEFIK_EDGE_IP" "$(read_env_value TRAEFIK_EDGE_IP || echo 172.23.0.2)"
env_set "OMNIROUTE_PUBLIC_URL" "https://$omniroute_host$public_suffix"
env_set "AUTH_COOKIE_SECURE" "true"

echo "HTTPS defaults ensured in $ENV_FILE"
