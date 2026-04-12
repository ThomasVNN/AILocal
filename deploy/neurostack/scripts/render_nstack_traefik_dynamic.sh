#!/usr/bin/env bash
# NeuroStack Traefik dynamic.yml renderer
# Adapted từ deploy/scripts/render_traefik_dynamic.sh
# Differences:
#   - Reads NS_DATA_ROOT (không phải LA_DATA_ROOT)
#   - Reads OMNIROUTER_HOST/API_HOST (không phải OMNIROUTE_*)
#   - Service names prefixed with ns- để tránh conflict với localagent Traefik labels
#   - Backend ports: omnirouter:21128, omnirouter:21129
#   - Middleware names: ns-default-ratelimit, ns-secure-headers
set -euo pipefail

NEUROSTACK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$(cd -- "$NEUROSTACK_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/nstack.local.env}"

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

# Read NS_ vars first, fallback to legacy names
NS_DATA_ROOT="${NS_DATA_ROOT:-$(read_env_value NS_DATA_ROOT || true)}"
if [[ -z "$NS_DATA_ROOT" ]]; then
  NS_DATA_ROOT="/data/neurostack"
fi

TRAEFIK_DASHBOARD_HOST="${TRAEFIK_DASHBOARD_HOST:-$(read_env_value TRAEFIK_DASHBOARD_HOST || true)}"
# OmniRouter uses OMNIROUTER_HOST (not OMNIROUTE_HOST)
OMNIROUTER_HOST="${OMNIROUTER_HOST:-$(read_env_value OMNIROUTER_HOST || true)}"
OMNIROUTER_API_HOST="${OMNIROUTER_API_HOST:-$(read_env_value OMNIROUTER_API_HOST || true)}"
OMNIROUTER_PORT="${OMNIROUTER_PORT:-$(read_env_value OMNIROUTER_PORT || echo '21128')}"
OMNIROUTER_API_PORT="${OMNIROUTER_API_PORT:-$(read_env_value OMNIROUTER_API_PORT || echo '21129')}"
OPENWEBUI_HOST="${OPENWEBUI_HOST:-$(read_env_value OPENWEBUI_HOST || true)}"
OPENCLAW_HOST="${OPENCLAW_HOST:-$(read_env_value OPENCLAW_HOST || true)}"
MINIO_API_HOST="${MINIO_API_HOST:-$(read_env_value MINIO_API_HOST || true)}"
MINIO_CONSOLE_HOST="${MINIO_CONSOLE_HOST:-$(read_env_value MINIO_CONSOLE_HOST || true)}"
TRAEFIK_TLS_ENABLED="${TRAEFIK_TLS_ENABLED:-$(read_env_value TRAEFIK_TLS_ENABLED || echo 'true')}"
TRAEFIK_HTTPS_PORT="${TRAEFIK_HTTPS_PORT:-$(read_env_value TRAEFIK_HTTPS_PORT || echo '9443')}"
TRAEFIK_HSTS_SECONDS="${TRAEFIK_HSTS_SECONDS:-$(read_env_value TRAEFIK_HSTS_SECONDS || echo '0')}"
TRAEFIK_HSTS_INCLUDE_SUBDOMAINS="${TRAEFIK_HSTS_INCLUDE_SUBDOMAINS:-$(read_env_value TRAEFIK_HSTS_INCLUDE_SUBDOMAINS || echo 'false')}"
TRAEFIK_HSTS_PRELOAD="${TRAEFIK_HSTS_PRELOAD:-$(read_env_value TRAEFIK_HSTS_PRELOAD || echo 'false')}"

out_dir="$NS_DATA_ROOT/platform/proxy/traefik"
out_file="$out_dir/dynamic.yml"
tmp_file="$out_file.tmp"

mkdir -p "$out_dir"

python3 - "$tmp_file" \
  "$TRAEFIK_DASHBOARD_HOST" \
  "$OMNIROUTER_HOST" \
  "$OMNIROUTER_API_HOST" \
  "$OPENWEBUI_HOST" \
  "$OPENCLAW_HOST" \
  "$MINIO_API_HOST" \
  "$MINIO_CONSOLE_HOST" \
  "$TRAEFIK_TLS_ENABLED" \
  "$TRAEFIK_HTTPS_PORT" \
  "$TRAEFIK_HSTS_SECONDS" \
  "$TRAEFIK_HSTS_INCLUDE_SUBDOMAINS" \
  "$TRAEFIK_HSTS_PRELOAD" \
  "$OMNIROUTER_PORT" \
  "$OMNIROUTER_API_PORT" <<'PY'
import sys

path = sys.argv[1]
traefik_host, router_host, api_host, chat_host, openclaw_host, s3_host, minio_host = sys.argv[2:9]
tls_enabled = sys.argv[9].lower() in {"1", "true", "yes", "on"}
https_port = int(sys.argv[10] or "9443")
hsts_seconds = int(sys.argv[11] or "0")
hsts_include_subdomains = sys.argv[12].lower() in {"1", "true", "yes", "on"}
hsts_preload = sys.argv[13].lower() in {"1", "true", "yes", "on"}
omnirouter_port = str(sys.argv[14]).strip() or "21128"
omnirouter_api_port = str(sys.argv[15]).strip() or "21129"

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
        return f"""    ns-{name}-http:
      rule: "{host_rule(host)}"
      entryPoints:
        - web
      middlewares:
        - redirect-to-https
      service: {service}
    ns-{name}:
      rule: "{host_rule(host)}"
      entryPoints:
        - websecure
      tls: {{}}
      middlewares:
        - ns-secure-headers
        - ns-ratelimit
      service: {service}
"""
    return f"""    ns-{name}:
      rule: "{host_rule(host)}"
      entryPoints:
        - web
      middlewares:
        - ns-secure-headers
        - ns-ratelimit
      service: {service}
"""

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
    ns-ratelimit:
      rateLimit:
        average: 60
        burst: 120
        period: 1s
    ns-retry:
      retry:
        attempts: 3
        initialInterval: 100ms
    ns-buffering:
      buffering:
        maxRequestBodyBytes: 10485760
        maxResponseBodyBytes: 104857600
        retryExpression: "IsNetworkError() && Attempts() < 3"
    ns-secure-headers:
      headers:
{hsts_lines}        contentTypeNosniff: true
        browserXssFilter: true
        frameDeny: true
        referrerPolicy: no-referrer
{redirect_middleware_block()}  routers:
{router_block("traefik", traefik_host, "api@internal")}{router_block("omnirouter-dashboard", router_host, "ns-omnirouter-dashboard")}{router_block("omnirouter-api", api_host, "ns-omnirouter-api")}{router_block("openwebui", chat_host, "ns-openwebui")}{router_block("openclaw", openclaw_host, "ns-openclaw")}{router_block("minio-api", s3_host, "ns-minio-api")}{router_block("minio-console", minio_host, "ns-minio-console")}  services:
    ns-omnirouter-dashboard:
      loadBalancer:
        servers:
          - url: "http://omnirouter:{omnirouter_port}"
    ns-omnirouter-api:
      loadBalancer:
        servers:
          - url: "http://omnirouter:{omnirouter_api_port}"
    ns-openwebui:
      loadBalancer:
        servers:
          - url: "http://open-webui:8080"
    ns-openclaw:
      loadBalancer:
        servers:
          - url: "http://openclaw-gateway:18789"
    ns-minio-api:
      loadBalancer:
        servers:
          - url: "http://minio:9000"
    ns-minio-console:
      loadBalancer:
        servers:
          - url: "http://minio:9001"
{tls_section}"""

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
PY

mv -f "$tmp_file" "$out_file"
echo "Rendered NeuroStack Traefik dynamic config: $out_file"
