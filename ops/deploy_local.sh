#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-$ROOT_DIR/deploy/env/stack.local.env}"
EXAMPLE_ENV="$ROOT_DIR/deploy/env/stack.env.example"

echo "[1/6] Review OmniRoute workspace"
if [[ -d "$ROOT_DIR/OmniRoute/.git" ]]; then
  git -C "$ROOT_DIR/OmniRoute" log -1 --oneline || true
  if ! git -C "$ROOT_DIR/OmniRoute" diff --no-ext-diff --quiet HEAD --; then
    echo "WARN: OmniRoute workspace has tracked changes." >&2
  fi
  if [[ "${DEPLOY_LOCAL_REVIEW_WORKSPACE:-0}" == "1" ]]; then
    git -C "$ROOT_DIR/OmniRoute" status --short || true
  fi
else
  echo "WARN: OmniRoute is not a git repo at $ROOT_DIR/OmniRoute"
fi

echo "[2/6] Ensure local env exists: $LOCAL_ENV_FILE"
if [[ ! -f "$LOCAL_ENV_FILE" ]]; then
  mkdir -p "$(dirname "$LOCAL_ENV_FILE")"
  cp "$EXAMPLE_ENV" "$LOCAL_ENV_FILE"
fi

needs_init="0"
if ! rg -q "^LOCAL_ENV_GENERATED=1$" "$LOCAL_ENV_FILE"; then
  needs_init="1"
fi

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
  ' "$LOCAL_ENV_FILE" > "$tmp_file"
  mv "$tmp_file" "$LOCAL_ENV_FILE"
}

env_set "TRAEFIK_HTTPS_PORT" "8443"

bash "$ROOT_DIR/deploy/scripts/ensure_https_env.sh" "$LOCAL_ENV_FILE"

rand_hex() {
  local nbytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$nbytes" | tr -d '\n'
  else
    python3 - "$nbytes" <<'PY'
import secrets, sys
n=int(sys.argv[1])
print(secrets.token_hex(n))
PY
  fi
}

rand_b64() {
  local nbytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$nbytes" | tr -d '\n'
  else
    python3 - "$nbytes" <<'PY'
import base64, os, sys
n=int(sys.argv[1])
print(base64.b64encode(os.urandom(n)).decode("ascii").replace("\n",""))
PY
  fi
}

if [[ "$needs_init" == "1" ]]; then
  LA_DATA_ROOT="$ROOT_DIR/.localagent-data"

  POSTGRES_PASSWORD="$(rand_hex 24)"
  REDIS_PASSWORD="$(rand_hex 24)"
  MINIO_ROOT_PASSWORD="$(rand_hex 32)"

  JWT_SECRET="$(rand_b64 48)"
  API_KEY_SECRET="$(rand_hex 32)"
  STORAGE_ENCRYPTION_KEY="$(rand_hex 32)"
  MACHINE_ID_SALT="$(rand_hex 16)"
  OPENCLAW_GATEWAY_TOKEN="$(rand_hex 32)"

  env_set "LA_DATA_ROOT" "$LA_DATA_ROOT"
  env_set "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"
  env_set "REDIS_PASSWORD" "$REDIS_PASSWORD"
  env_set "MINIO_ROOT_PASSWORD" "$MINIO_ROOT_PASSWORD"

  env_set "JWT_SECRET" "$JWT_SECRET"
  env_set "API_KEY_SECRET" "$API_KEY_SECRET"
  env_set "STORAGE_ENCRYPTION_KEY" "$STORAGE_ENCRYPTION_KEY"
  env_set "MACHINE_ID_SALT" "$MACHINE_ID_SALT"
  env_set "OPENCLAW_GATEWAY_TOKEN" "$OPENCLAW_GATEWAY_TOKEN"

  # Local images & platform (Apple Silicon).
  env_set "OMNIROUTE_IMAGE" "omniroute:local"
  env_set "OMNIROUTE_PLATFORM" "linux/arm64"
  env_set "OPENWEBUI_IMAGE" "open-webui:local"
  env_set "OPENWEBUI_PLATFORM" "linux/arm64"
  env_set "OPENCLAW_IMAGE" "openclaw:local"
  env_set "OPENCLAW_PLATFORM" "linux/arm64"

  # Friendly default password for OmniRoute bootstrap (user should rotate).
  env_set "INITIAL_PASSWORD" "OmniR0ute@local"
  env_set "OPENWEBUI_OPENAI_API_KEY" ""
  env_set "OPENCLAW_OPENAI_API_KEY" ""
  env_set "OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH" "true"

  # Keep dependent URLs aligned with generated secrets.
  env_set "OPENWEBUI_DATABASE_URL" "postgresql://localagent:${POSTGRES_PASSWORD}@postgres-primary:5432/openwebui"
  env_set "OPENWEBUI_REDIS_URL" "redis://:${REDIS_PASSWORD}@redis:6379/0"
  env_set "OPENWEBUI_WEBSOCKET_REDIS_URL" "redis://:${REDIS_PASSWORD}@redis:6379/0"
  env_set "OPENWEBUI_S3_SECRET_ACCESS_KEY" "$MINIO_ROOT_PASSWORD"
  env_set "LOCAL_ENV_GENERATED" "1"

  echo "Initialized $LOCAL_ENV_FILE"
  echo "Data root: $LA_DATA_ROOT"
fi

if ! rg -q "^OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH=" "$LOCAL_ENV_FILE"; then
  env_set "OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH" "true"
fi

bash "$ROOT_DIR/deploy/scripts/reconcile_app_image_env.sh" local "$LOCAL_ENV_FILE"

DEPLOY_LOCAL_STOP_FIRST="${DEPLOY_LOCAL_STOP_FIRST:-1}"
if [[ "$DEPLOY_LOCAL_STOP_FIRST" == "1" ]]; then
  echo "[2.5/6] Stop existing localagent stack (free memory)"
  ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/stack.sh" apps down --remove-orphans || true
  ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/stack.sh" platform down --remove-orphans || true
fi

echo "[3/6] Build app images from workspace source"
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/build_app_images.sh" omniroute open-webui openclaw

echo "[4/6] Bring up stack"
LA_DATA_ROOT="$(sed -n 's/^LA_DATA_ROOT=//p' "$LOCAL_ENV_FILE" | tail -n 1)"
bash "$ROOT_DIR/deploy/scripts/bootstrap_data_dirs.sh" "$LA_DATA_ROOT"
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/bootstrap_extra_ca.sh"
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/stack.sh" platform up -d
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/wait_for_service_health.sh" platform postgres-primary 180
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/wait_for_service_health.sh" platform redis 180

# Seed OpenClaw Control UI allowlist before starting gateway (avoids crash-loop).
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/bootstrap_openclaw.sh"

ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/stack.sh" apps up -d --no-deps omniroute
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/wait_for_service_health.sh" apps omniroute 420
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/bootstrap_app_clients.sh"
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/stack.sh" apps up -d --no-deps openclaw-cli
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/wait_for_service_health.sh" apps open-webui 300
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/wait_for_service_health.sh" apps openclaw-gateway 300

echo "[4.5/6] Refresh Traefik host port bindings"
docker restart localagent-platform-traefik-1 >/dev/null
sleep 3

echo "[5/6] Healthcheck"
ENV_FILE="$LOCAL_ENV_FILE" HEALTHCHECK_TIMEOUT_SECONDS="${HEALTHCHECK_TIMEOUT_SECONDS:-420}" HEALTHCHECK_INTERVAL_SECONDS="${HEALTHCHECK_INTERVAL_SECONDS:-10}" \
  bash "$ROOT_DIR/deploy/scripts/healthcheck.sh" local

echo "[6/6] Smoke test"
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/smoke_stack.sh" local

echo "OK: local deploy complete."
