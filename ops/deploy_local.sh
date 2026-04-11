#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-$ROOT_DIR/deploy/env/stack.local.env}"
EXAMPLE_ENV="$ROOT_DIR/deploy/env/stack.env.example"

echo "[1/5] Review OmniRoute workspace"
if [[ -d "$ROOT_DIR/OmniRoute/.git" ]]; then
  git -C "$ROOT_DIR/OmniRoute" status --porcelain || true
  git -C "$ROOT_DIR/OmniRoute" log -1 --oneline || true
else
  echo "WARN: OmniRoute is not a git repo at $ROOT_DIR/OmniRoute"
fi

echo "[2/5] Ensure local env exists: $LOCAL_ENV_FILE"
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
  python3 - "$LOCAL_ENV_FILE" "$key" "$value" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]

lines = path.read_text(encoding="utf-8").splitlines(True)
out = []
replaced = False
prefix = key + "="
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

build_local_image() {
  local tag="$1"
  local dockerfile="$2"
  local context="$3"
  shift 3
  local build_cmd=(
    docker buildx build
    --platform linux/arm64
    -t "$tag"
    -f "$dockerfile"
  )

  if (($# > 0)); then
    build_cmd+=("$@")
  fi

  build_cmd+=("$context" --load)

  if "${build_cmd[@]}"; then
    return 0
  fi

  echo "WARN: buildx failed for $tag; retrying with classic builder + local cache" >&2
  local fallback_cmd=(
    docker build
    --build-arg TARGETARCH=arm64
    -t "$tag"
    -f "$dockerfile"
  )

  if (($# > 0)); then
    fallback_cmd+=("$@")
  fi

  fallback_cmd+=("$context")

  DOCKER_BUILDKIT=0 "${fallback_cmd[@]}"
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

DEPLOY_LOCAL_STOP_FIRST="${DEPLOY_LOCAL_STOP_FIRST:-1}"
if [[ "$DEPLOY_LOCAL_STOP_FIRST" == "1" ]]; then
  echo "[2.5/5] Stop existing localagent stack (free memory)"
  ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/stack.sh" apps down --remove-orphans || true
  ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/stack.sh" platform down --remove-orphans || true
fi

echo "[3/5] Build images (OmniRoute + OpenClaw)"
OMNIROUTE_BUILD_NODE_OPTIONS="${OMNIROUTE_BUILD_NODE_OPTIONS:---max-old-space-size=3072}"
OMNIROUTE_NEXT_BUILD_CPUS="${OMNIROUTE_NEXT_BUILD_CPUS:-2}"
# Local machine may run behind TLS-intercept proxy (e.g., Charles/Tailscale setup).
# Allow disabling strict npm TLS only for local image build; override to true if not needed.
OMNIROUTE_BUILD_NPM_STRICT_SSL="${OMNIROUTE_BUILD_NPM_STRICT_SSL:-false}"
# Same reason for node-gyp header downloads (nodejs.org) during native module fallback builds.
OMNIROUTE_BUILD_NODE_TLS_REJECT_UNAUTHORIZED="${OMNIROUTE_BUILD_NODE_TLS_REJECT_UNAUTHORIZED:-0}"
build_local_image \
  omniroute:local \
  "$ROOT_DIR/OmniRoute/Dockerfile" \
  "$ROOT_DIR/OmniRoute" \
  --target runner-base \
  --build-arg BUILD_NODE_OPTIONS="$OMNIROUTE_BUILD_NODE_OPTIONS" \
  --build-arg OMNIROUTE_NEXT_BUILD_CPUS="$OMNIROUTE_NEXT_BUILD_CPUS" \
  --build-arg NPM_CONFIG_STRICT_SSL="$OMNIROUTE_BUILD_NPM_STRICT_SSL" \
  --build-arg NODE_TLS_REJECT_UNAUTHORIZED="$OMNIROUTE_BUILD_NODE_TLS_REJECT_UNAUTHORIZED"

build_local_image \
  openclaw:local \
  "$ROOT_DIR/openclaw/Dockerfile" \
  "$ROOT_DIR/openclaw"

echo "[4/5] Bring up stack"
LA_DATA_ROOT="$(python3 - "$LOCAL_ENV_FILE" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
for line in path.read_text(encoding="utf-8").splitlines():
  if line.startswith("LA_DATA_ROOT="):
    print(line.split("=", 1)[1])
    break
PY
)"
bash "$ROOT_DIR/deploy/scripts/bootstrap_data_dirs.sh" "$LA_DATA_ROOT"
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/bootstrap_extra_ca.sh"
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/stack.sh" platform up -d

# Seed OpenClaw Control UI allowlist before starting gateway (avoids crash-loop).
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/bootstrap_openclaw.sh" || true

ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/stack.sh" apps up -d
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/bootstrap_app_clients.sh"

echo "[4.5/5] Refresh Traefik host port bindings"
docker restart localagent-platform-traefik-1 >/dev/null
sleep 3

echo "[5/6] Healthcheck"
ENV_FILE="$LOCAL_ENV_FILE" HEALTHCHECK_TIMEOUT_SECONDS="${HEALTHCHECK_TIMEOUT_SECONDS:-420}" HEALTHCHECK_INTERVAL_SECONDS="${HEALTHCHECK_INTERVAL_SECONDS:-10}" \
  bash "$ROOT_DIR/deploy/scripts/healthcheck.sh" local

echo "[6/6] Smoke test"
ENV_FILE="$LOCAL_ENV_FILE" bash "$ROOT_DIR/deploy/scripts/smoke_stack.sh" local

echo "OK: local deploy complete."
