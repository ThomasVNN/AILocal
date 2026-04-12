#!/usr/bin/env bash
# NeuroStack — Local Deploy Script (M1 Mac, Apple Silicon)
# Brand: neurostack (isolated từ localagent)
# Entry: bash ops/agent.sh deploy nstack-local
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NEUROSTACK_DIR="$ROOT_DIR/deploy/neurostack"
NS_SCRIPTS="$NEUROSTACK_DIR/scripts"
DEPLOY_SCRIPTS="$ROOT_DIR/deploy/scripts"

NS_ENV_FILE="${NS_ENV_FILE:-$ROOT_DIR/deploy/env/nstack.local.env}"
NS_EXAMPLE_ENV="$ROOT_DIR/deploy/env/nstack.local.env.example"

echo "╔══════════════════════════════════════════════════╗"
echo "║        NeuroStack — Local Deploy (M1/arm64)       ║"
echo "╚══════════════════════════════════════════════════╝"

# ──────────────────────────────────────────────────────
# [0] Review source workspaces (custom forks)
# ──────────────────────────────────────────────────────
echo "[0/7] Review custom fork workspaces"
for repo in OmniRoute openclaw open-webui; do
  if [[ -d "$ROOT_DIR/$repo/.git" ]]; then
    echo "  $repo: $(git -C "$ROOT_DIR/$repo" log -1 --oneline 2>/dev/null || echo 'no commits')"
    if ! git -C "$ROOT_DIR/$repo" diff --no-ext-diff --quiet HEAD -- 2>/dev/null; then
      echo "  WARN: $repo has uncommitted changes" >&2
    fi
  else
    echo "  WARN: $repo/.git not found" >&2
  fi
done

# ──────────────────────────────────────────────────────
# [1] Ensure env file + auto-generate secrets
# ──────────────────────────────────────────────────────
echo "[1/7] Ensure nstack.local.env..."
if [[ ! -f "$NS_ENV_FILE" ]]; then
  mkdir -p "$(dirname "$NS_ENV_FILE")"
  cp "$NS_EXAMPLE_ENV" "$NS_ENV_FILE"
  echo "  Created from example: $NS_EXAMPLE_ENV"
fi

ns_env_get() {
  grep -E "^[[:space:]]*${1}=" "$NS_ENV_FILE" 2>/dev/null | tail -n 1 | sed 's/^[^=]*=//' || true
}
ns_env_set() {
  local key="$1" value="$2"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/nstack-env.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { prefix=key"="; replaced=0 }
    index($0,prefix)==1 && replaced==0 { print prefix value; replaced=1; next }
    { print }
    END { if (replaced==0) { print prefix value } }
  ' "$NS_ENV_FILE" > "$tmp"
  mv "$tmp" "$NS_ENV_FILE"
}
rand_hex() { openssl rand -hex "$1" 2>/dev/null || python3 -c "import secrets,sys;print(secrets.token_hex(int(sys.argv[1])))" "$1"; }
rand_b64() { openssl rand -base64 "$1" 2>/dev/null | tr -d '\n' || python3 -c "import base64,os,sys;print(base64.b64encode(os.urandom(int(sys.argv[1]))).decode())" "$1"; }

needs_init="0"
if ! grep -q "^NS_ENV_GENERATED=1$" "$NS_ENV_FILE" 2>/dev/null; then
  needs_init="1"
fi

if [[ "$needs_init" == "1" ]]; then
  echo "  Auto-generating secrets..."
  NS_DATA_ROOT="$ROOT_DIR/.nstack-data"
  POSTGRES_PASSWORD="$(rand_hex 24)"
  REDIS_PASSWORD="$(rand_hex 24)"
  MINIO_ROOT_PASSWORD="$(rand_hex 32)"
  JWT_SECRET="$(rand_b64 48)"
  API_KEY_SECRET="$(rand_hex 32)"
  STORAGE_ENCRYPTION_KEY="$(rand_hex 32)"
  MACHINE_ID_SALT="$(rand_hex 16)"
  OPENCLAW_GATEWAY_TOKEN="$(rand_hex 32)"

  ns_env_set "NS_DATA_ROOT" "$NS_DATA_ROOT"
  ns_env_set "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"
  ns_env_set "REDIS_PASSWORD" "$REDIS_PASSWORD"
  ns_env_set "MINIO_ROOT_PASSWORD" "$MINIO_ROOT_PASSWORD"
  ns_env_set "JWT_SECRET" "$JWT_SECRET"
  ns_env_set "API_KEY_SECRET" "$API_KEY_SECRET"
  ns_env_set "STORAGE_ENCRYPTION_KEY" "$STORAGE_ENCRYPTION_KEY"
  ns_env_set "MACHINE_ID_SALT" "$MACHINE_ID_SALT"
  ns_env_set "OPENCLAW_GATEWAY_TOKEN" "$OPENCLAW_GATEWAY_TOKEN"
  ns_env_set "NS_OMNIROUTER_IMAGE" "omnirouter:local"
  ns_env_set "NS_OMNIROUTER_PLATFORM" "linux/arm64"
  ns_env_set "NS_OPENCLAW_IMAGE" "openclaw:local"
  ns_env_set "NS_OPENCLAW_PLATFORM" "linux/arm64"
  ns_env_set "INITIAL_PASSWORD" "NeuroStack@local"
  ns_env_set "OPENWEBUI_OPENAI_API_KEY" ""
  ns_env_set "OPENCLAW_OPENAI_API_KEY" ""
  ns_env_set "OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH" "true"
  ns_env_set "TRAEFIK_HTTPS_PORT" "9443"
  ns_env_set "OPENWEBUI_DATABASE_URL" "postgresql://neurostack:${POSTGRES_PASSWORD}@postgres-primary:5432/neurostack"
  ns_env_set "OPENWEBUI_REDIS_URL" "redis://:${REDIS_PASSWORD}@redis:6379/0"
  ns_env_set "OPENWEBUI_WEBSOCKET_REDIS_URL" "redis://:${REDIS_PASSWORD}@redis:6379/0"
  ns_env_set "OPENWEBUI_S3_SECRET_ACCESS_KEY" "$MINIO_ROOT_PASSWORD"
  ns_env_set "OPENWEBUI_S3_ACCESS_KEY_ID" "neurostack"
  ns_env_set "NS_ENV_GENERATED" "1"
  echo "  Secrets generated. Data: $NS_DATA_ROOT"
else
  echo "  Secrets already exist — skipping"
fi

# Always enforce local HTTPS port
ns_env_set "TRAEFIK_HTTPS_PORT" "9443"

# ──────────────────────────────────────────────────────
# [2] Build app images FIRST (before stopping — minimizes downtime)
# ──────────────────────────────────────────────────────
echo "[2/7] Build NeuroStack images from custom fork source..."

NS_OMNIROUTER_IMAGE="$(ns_env_get NS_OMNIROUTER_IMAGE)"
NS_OMNIROUTER_PLATFORM="$(ns_env_get NS_OMNIROUTER_PLATFORM)"
NS_OPENCLAW_IMAGE="$(ns_env_get NS_OPENCLAW_IMAGE)"
NS_OPENCLAW_PLATFORM="$(ns_env_get NS_OPENCLAW_PLATFORM)"

# Export with old var names for build_app_images.sh compatibility
export OMNIROUTE_IMAGE="$NS_OMNIROUTER_IMAGE"
export OMNIROUTE_PLATFORM="$NS_OMNIROUTER_PLATFORM"
export OPENCLAW_IMAGE="$NS_OPENCLAW_IMAGE"
export OPENCLAW_PLATFORM="$NS_OPENCLAW_PLATFORM"
export ENV_FILE="$NS_ENV_FILE"

bash "$DEPLOY_SCRIPTS/build_app_images.sh" omniroute openclaw

# ──────────────────────────────────────────────────────
# [3] Stop existing apps layer ONLY (platform stays up → ~30s downtime)
# ──────────────────────────────────────────────────────
DEPLOY_STOP_FIRST="${NS_DEPLOY_STOP_FIRST:-1}"
if [[ "$DEPLOY_STOP_FIRST" == "1" ]]; then
  echo "[3/7] Stop existing neurostack apps (platform stays up)..."
  ENV_FILE="$NS_ENV_FILE" bash "$NS_SCRIPTS/nstack_stack.sh" apps down --remove-orphans 2>/dev/null || true
else
  echo "[3/7] Skip stop (NS_DEPLOY_STOP_FIRST=0)"
fi

# ──────────────────────────────────────────────────────
# [4] Bootstrap data dirs + TLS + Platform (Layer 1)
# ──────────────────────────────────────────────────────
echo "[4/7] Bootstrap platform..."
NS_DATA_ROOT_VAL="$(ns_env_get NS_DATA_ROOT)"

# LA_DATA_ROOT alias for scripts that expect it
export LA_DATA_ROOT="$NS_DATA_ROOT_VAL"

bash "$DEPLOY_SCRIPTS/bootstrap_data_dirs.sh" "$NS_DATA_ROOT_VAL"

# Extra CA bundle (Charles proxy cert, etc.)
ENV_FILE="$NS_ENV_FILE" bash "$DEPLOY_SCRIPTS/bootstrap_extra_ca.sh"

# Bring up Platform — nstack_stack.sh handles TLS + dynamic.yml rendering
ENV_FILE="$NS_ENV_FILE" bash "$NS_SCRIPTS/nstack_stack.sh" platform up -d

ENV_FILE="$NS_ENV_FILE" bash "$NS_SCRIPTS/wait_nstack_health.sh" platform postgres-primary 180
ENV_FILE="$NS_ENV_FILE" bash "$NS_SCRIPTS/wait_nstack_health.sh" platform redis 180

# ──────────────────────────────────────────────────────
# [5] Bootstrap OpenClaw + Apps (Layer 2)
# ──────────────────────────────────────────────────────
echo "[5/7] Bootstrap OpenClaw + bring up apps..."

# Bootstrap OpenClaw security (allowed origins, trusted proxies)
ENV_FILE="$NS_ENV_FILE" bash "$DEPLOY_SCRIPTS/bootstrap_openclaw.sh"

# OmniRouter first (others depend on it)
ENV_FILE="$NS_ENV_FILE" bash "$NS_SCRIPTS/nstack_stack.sh" apps up -d --no-deps omnirouter
ENV_FILE="$NS_ENV_FILE" bash "$NS_SCRIPTS/wait_nstack_health.sh" apps omnirouter 420

# Provision API keys + sync OpenWebUI/OpenClaw config
ENV_FILE="$NS_ENV_FILE" bash "$NS_SCRIPTS/bootstrap_nstack_app_clients.sh"

# Remaining apps
ENV_FILE="$NS_ENV_FILE" bash "$NS_SCRIPTS/nstack_stack.sh" apps up -d --no-deps openclaw-cli
ENV_FILE="$NS_ENV_FILE" bash "$NS_SCRIPTS/wait_nstack_health.sh" apps open-webui 300
ENV_FILE="$NS_ENV_FILE" bash "$NS_SCRIPTS/wait_nstack_health.sh" apps openclaw-gateway 300

# Refresh Traefik (pick up port bindings)
echo "  Refreshing Traefik..."
docker restart neurostack-platform-traefik-1 > /dev/null 2>&1 || true
sleep 3

# ──────────────────────────────────────────────────────
# [6] Healthcheck
# ──────────────────────────────────────────────────────
echo "[6/7] Healthcheck..."
NS_HTTPS_PORT="$(ns_env_get TRAEFIK_HTTPS_PORT)"
NS_ROUTER_HOST="$(ns_env_get OMNIROUTER_HOST)"
NS_CHAT_HOST="$(ns_env_get OPENWEBUI_HOST)"
NS_CLAW_HOST="$(ns_env_get OPENCLAW_HOST)"
NS_API_HOST="$(ns_env_get OMNIROUTER_API_HOST)"

# Quick smoke test on key endpoints
smoke_check() {
  local name="$1" url="$2"
  local code
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo '000')"
  if [[ "$code" =~ ^[23] ]]; then
    echo "  ✓ $name ($code)"
  else
    echo "  ⚠ $name - HTTP $code (may need CA trust or service to warm up)"
  fi
}

smoke_check "OmniRouter Health" "https://${NS_ROUTER_HOST}:${NS_HTTPS_PORT}/healthz"
smoke_check "OmniRouter API"    "https://${NS_API_HOST}:${NS_HTTPS_PORT}/v1/models"
smoke_check "OpenWebUI"         "https://${NS_CHAT_HOST}:${NS_HTTPS_PORT}/"
smoke_check "OpenClaw"          "https://${NS_CLAW_HOST}:${NS_HTTPS_PORT}/healthz"

# ──────────────────────────────────────────────────────
# [7] Summary
# ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         NeuroStack Local Deploy Complete ✓                ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf "║  OmniRouter : https://%s:%s\n" "$NS_ROUTER_HOST" "$NS_HTTPS_PORT"
printf "║  API Endpoint: https://%s:%s/v1\n" "$NS_API_HOST" "$NS_HTTPS_PORT"
printf "║  OpenWebUI  : https://%s:%s\n" "$NS_CHAT_HOST" "$NS_HTTPS_PORT"
printf "║  OpenClaw   : https://%s:%s\n" "$NS_CLAW_HOST" "$NS_HTTPS_PORT"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "IMPORTANT — Make sure /etc/hosts has these entries:"
printf "  127.0.0.1  %s %s %s %s\n" "$NS_ROUTER_HOST" "$NS_API_HOST" "$NS_CHAT_HOST" "$NS_CLAW_HOST"
echo "  127.0.0.1  s3.nstack.local minio.nstack.local traefik.nstack.local"
echo ""
echo "Trust NeuroStack CA cert:"
printf "  %s/platform/proxy/traefik/ca/ca.crt\n" "$NS_DATA_ROOT_VAL"
