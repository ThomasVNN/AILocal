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
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
prefix = key + "="

lines = path.read_text(encoding="utf-8").splitlines(True)
out = []
replaced = False
for line in lines:
  if line.startswith(prefix) and not replaced:
    out.append(prefix + value + "\n")
    replaced = True
  else:
    out.append(line)

if not replaced:
  if out and not out[-1].endswith("\n"):
    out[-1] = out[-1] + "\n"
  out.append(prefix + value + "\n")

path.write_text("".join(out), encoding="utf-8")
PY
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
