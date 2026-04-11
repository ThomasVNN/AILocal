#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"

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

LA_DATA_ROOT="${LA_DATA_ROOT:-$(read_env_value LA_DATA_ROOT || true)}"
if [[ -z "$LA_DATA_ROOT" ]]; then
  LA_DATA_ROOT="/data/localagent"
fi

TRAEFIK_DASHBOARD_HOST="${TRAEFIK_DASHBOARD_HOST:-$(read_env_value TRAEFIK_DASHBOARD_HOST || true)}"
OMNIROUTE_HOST="${OMNIROUTE_HOST:-$(read_env_value OMNIROUTE_HOST || true)}"
OMNIROUTE_API_HOST="${OMNIROUTE_API_HOST:-$(read_env_value OMNIROUTE_API_HOST || true)}"
OPENWEBUI_HOST="${OPENWEBUI_HOST:-$(read_env_value OPENWEBUI_HOST || true)}"
OPENCLAW_HOST="${OPENCLAW_HOST:-$(read_env_value OPENCLAW_HOST || true)}"
MINIO_API_HOST="${MINIO_API_HOST:-$(read_env_value MINIO_API_HOST || true)}"
MINIO_CONSOLE_HOST="${MINIO_CONSOLE_HOST:-$(read_env_value MINIO_CONSOLE_HOST || true)}"
TRAEFIK_TLS_ENABLED="${TRAEFIK_TLS_ENABLED:-$(read_env_value TRAEFIK_TLS_ENABLED || true)}"
TRAEFIK_HTTPS_PORT="${TRAEFIK_HTTPS_PORT:-$(read_env_value TRAEFIK_HTTPS_PORT || true)}"
TRAEFIK_HSTS_SECONDS="${TRAEFIK_HSTS_SECONDS:-$(read_env_value TRAEFIK_HSTS_SECONDS || true)}"
TRAEFIK_HSTS_INCLUDE_SUBDOMAINS="${TRAEFIK_HSTS_INCLUDE_SUBDOMAINS:-$(read_env_value TRAEFIK_HSTS_INCLUDE_SUBDOMAINS || true)}"
TRAEFIK_HSTS_PRELOAD="${TRAEFIK_HSTS_PRELOAD:-$(read_env_value TRAEFIK_HSTS_PRELOAD || true)}"

if [[ -z "$TRAEFIK_TLS_ENABLED" ]]; then
  TRAEFIK_TLS_ENABLED="true"
fi
if [[ -z "$TRAEFIK_HTTPS_PORT" ]]; then
  TRAEFIK_HTTPS_PORT="443"
fi
if [[ -z "$TRAEFIK_HSTS_SECONDS" ]]; then
  TRAEFIK_HSTS_SECONDS="0"
fi
if [[ -z "$TRAEFIK_HSTS_INCLUDE_SUBDOMAINS" ]]; then
  TRAEFIK_HSTS_INCLUDE_SUBDOMAINS="false"
fi
if [[ -z "$TRAEFIK_HSTS_PRELOAD" ]]; then
  TRAEFIK_HSTS_PRELOAD="false"
fi

out_dir="$LA_DATA_ROOT/platform/proxy/traefik"
out_file="$out_dir/dynamic.yml"
tmp_file="$out_file.tmp"

mkdir -p "$out_dir"

python3 - "$tmp_file" \
  "$TRAEFIK_DASHBOARD_HOST" \
  "$OMNIROUTE_HOST" \
  "$OMNIROUTE_API_HOST" \
  "$OPENWEBUI_HOST" \
  "$OPENCLAW_HOST" \
  "$MINIO_API_HOST" \
  "$MINIO_CONSOLE_HOST" \
  "$TRAEFIK_TLS_ENABLED" \
  "$TRAEFIK_HTTPS_PORT" \
  "$TRAEFIK_HSTS_SECONDS" \
  "$TRAEFIK_HSTS_INCLUDE_SUBDOMAINS" \
  "$TRAEFIK_HSTS_PRELOAD" <<'PY'
import sys

path = sys.argv[1]
traefik_host, router_host, api_host, chat_host, openclaw_host, s3_host, minio_host = sys.argv[2:9]
tls_enabled = sys.argv[9].lower() in {"1", "true", "yes", "on"}
https_port = int(sys.argv[10] or "443")
hsts_seconds = int(sys.argv[11] or "0")
hsts_include_subdomains = sys.argv[12].lower() in {"1", "true", "yes", "on"}
hsts_preload = sys.argv[13].lower() in {"1", "true", "yes", "on"}

def host_rule(h: str) -> str:
  if not h:
    return "Host(`invalid.localhost`)"
  return f"Host(`{h}`)"

def redirect_middleware_block() -> str:
  if not tls_enabled:
    return ""
  if https_port == 443:
    return """    redirect-to-https:
      redirectScheme:
        scheme: https
        permanent: true
"""
  return f"""    redirect-to-https:
      redirectRegex:
        regex: "^http://([^/]+)(/.*)?$"
        replacement: "https://${{1}}:{https_port}${{2}}"
        permanent: true
"""

def router_block(name: str, host: str, service: str) -> str:
  if tls_enabled:
    return f"""    {name}-http:
      rule: "{host_rule(host)}"
      entryPoints:
        - web
      middlewares:
        - redirect-to-https
      service: {service}
    {name}:
      rule: "{host_rule(host)}"
      entryPoints:
        - websecure
      tls: {{}}
      middlewares:
        - secure-headers
        - default-ratelimit
      service: {service}
"""
  return f"""    {name}:
      rule: "{host_rule(host)}"
      entryPoints:
        - web
      middlewares:
        - secure-headers
        - default-ratelimit
      service: {service}
"""

hsts_block = ""
hsts_lines = ""
if hsts_seconds > 0:
  hsts_lines = f"""        stsSeconds: {hsts_seconds}
        stsIncludeSubdomains: {"true" if hsts_include_subdomains else "false"}
        stsPreload: {"true" if hsts_preload else "false"}
        forceSTSHeader: true
"""

tls_section = ""
if tls_enabled:
  tls_section = """
tls:
  stores:
    default:
      defaultCertificate:
        certFile: /etc/traefik/certs/tls.crt
        keyFile: /etc/traefik/certs/tls.key
  options:
    default:
      minVersion: VersionTLS12
"""

content = f"""http:
  middlewares:
    default-ratelimit:
      rateLimit:
        average: 120
        burst: 60
        period: 1s
    secure-headers:
      headers:
{hsts_lines}        contentTypeNosniff: true
        browserXssFilter: true
        frameDeny: true
        referrerPolicy: no-referrer
{redirect_middleware_block()}  routers:
{router_block("traefik", traefik_host, "api@internal")}{router_block("omniroute-dashboard", router_host, "omniroute-dashboard")}{router_block("omniroute-api", api_host, "omniroute-api")}{router_block("openwebui", chat_host, "openwebui")}{router_block("openclaw", openclaw_host, "openclaw")}{router_block("minio-api", s3_host, "minio-api")}{router_block("minio-console", minio_host, "minio-console")}  services:
    omniroute-dashboard:
      loadBalancer:
        servers:
          - url: "http://omniroute:20128"
    omniroute-api:
      loadBalancer:
        servers:
          - url: "http://omniroute:20129"
    openwebui:
      loadBalancer:
        servers:
          - url: "http://open-webui:8080"
    openclaw:
      loadBalancer:
        servers:
          - url: "http://openclaw-gateway:18789"
    minio-api:
      loadBalancer:
        servers:
          - url: "http://minio:9000"
    minio-console:
      loadBalancer:
        servers:
          - url: "http://minio:9001"
{tls_section}"""

with open(path, "w", encoding="utf-8") as f:
  f.write(content)
PY

mv -f "$tmp_file" "$out_file"
echo "Rendered Traefik dynamic config: $out_file"
