#!/usr/bin/env bash
# NeuroStack — Server Deploy Script (Linux Intel x86_64/amd64)
# Target server: 192.168.1.65 / Tailscale: 100.101.77.8 (user: mzk-12-10)
# Entry: bash ops/agent.sh deploy nstack-server
#        OR: SERVER_SSH_PASS='<your-password>' bash ops/nstack_deploy_server.sh
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Server connection config
SERVER_REMOTE="${SERVER_REMOTE:-mzk-12-10@100.101.77.8}"
SERVER_DIR="${SERVER_DIR:-/home/mzk-12-10/neurostack}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$SERVER_DIR/deploy/env/nstack.server.env}"
SERVER_SSH_KEY="${SERVER_SSH_KEY:-}"
SERVER_SSH_PASS="${SERVER_SSH_PASS:-}"
SERVER_STRICT_HOST_KEY_CHECKING="${SERVER_STRICT_HOST_KEY_CHECKING:-accept-new}"

NS_EXAMPLE_ENV="$ROOT_DIR/deploy/env/nstack.server.env.example"
NS_COMPOSE_DIR="deploy/neurostack"

SSH_OPTS=(-o "StrictHostKeyChecking=${SERVER_STRICT_HOST_KEY_CHECKING}")
if [[ -n "$SERVER_SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SERVER_SSH_KEY")
fi

if [[ -n "$SERVER_SSH_PASS" ]]; then
  SSH_BASE=(sshpass -p "$SERVER_SSH_PASS" ssh "${SSH_OPTS[@]}")
  SCP_BASE=(sshpass -p "$SERVER_SSH_PASS" scp "${SSH_OPTS[@]}")
  RSYNC_PASS=("--rsh=sshpass -p $SERVER_SSH_PASS ssh ${SSH_OPTS[*]}")
else
  SSH_BASE=(ssh "${SSH_OPTS[@]}")
  SCP_BASE=(scp "${SSH_OPTS[@]}")
  RSYNC_PASS=()
fi

echo "╔══════════════════════════════════════════════════╗"
echo "║     NeuroStack — Server Deploy (Intel/amd64)      ║"
echo "║     Target: ${SERVER_REMOTE}               "
echo "╚══════════════════════════════════════════════════╝"

# ──────────────────────────────────────────────────────
# [1] Review source workspaces
# ──────────────────────────────────────────────────────
echo "[1/6] Review source workspaces"
for repo in OmniRoute openclaw open-webui; do
  if [[ -d "$ROOT_DIR/$repo/.git" ]]; then
    echo "  $repo: $(git -C "$ROOT_DIR/$repo" log -1 --oneline 2>/dev/null || echo 'no commits')"
    if ! git -C "$ROOT_DIR/$repo" diff --no-ext-diff --quiet HEAD -- 2>/dev/null; then
      echo "  WARN: $repo has uncommitted changes" >&2
    fi
  fi
done

# ──────────────────────────────────────────────────────
# [2] Build amd64 app images from source (custom forks)
# ──────────────────────────────────────────────────────
echo "[2/6] Build NeuroStack amd64 images from source..."

tmp_images="$(mktemp -t nstack-app-images.XXXXXX.tar.gz)"
tmp_deploy="$(mktemp -t nstack-deploy.XXXXXX.tar.gz)"
trap 'rm -f "$tmp_images" "$tmp_deploy"' EXIT

OMNIROUTE_IMAGE="omnirouter:intel" \
OMNIROUTE_PLATFORM="linux/amd64" \
OPENCLAW_IMAGE="openclaw:intel" \
OPENCLAW_PLATFORM="linux/amd64" \
ENV_FILE="$NS_EXAMPLE_ENV" \
  bash "$ROOT_DIR/deploy/scripts/build_app_images.sh" omniroute openclaw

# Save images
docker save omnirouter:intel openclaw:intel | gzip -c > "$tmp_images"
echo "  Images saved: omnirouter:intel, openclaw:intel"

# Package deploy bundle (neurostack configs + scripts)
tar -C "$ROOT_DIR" \
  --exclude='deploy/env/nstack.local.env' \
  --exclude='deploy/env/stack.env' \
  --exclude='deploy/env/stack.local.env' \
  --exclude='.DS_Store' \
  -czf "$tmp_deploy" \
  deploy

echo "  Deploy bundle packaged"

# ──────────────────────────────────────────────────────
# [3] Upload to server
# ──────────────────────────────────────────────────────
echo "[3/6] Upload deploy bundle + images to ${SERVER_REMOTE}..."

remote_tmp="\$HOME/.nstack_tmp"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "mkdir -p $SERVER_DIR $remote_tmp"
"${SCP_BASE[@]}" "$tmp_deploy" "$SERVER_REMOTE:$remote_tmp/deploy_bundle.tar.gz"
"${SCP_BASE[@]}" "$tmp_images" "$SERVER_REMOTE:$remote_tmp/app_images.tar.gz"
echo "  Upload complete"

# ──────────────────────────────────────────────────────
# [4] Remote deploy
# ──────────────────────────────────────────────────────
echo "[4/6] Remote deploy on ${SERVER_REMOTE}..."
"${SSH_BASE[@]}" "$SERVER_REMOTE" "set -euo pipefail
  mkdir -p $SERVER_DIR
  tar -xzf $remote_tmp/deploy_bundle.tar.gz -C $SERVER_DIR

  # Bootstrap server env if not exists
  mkdir -p \$(dirname $SERVER_ENV_FILE)
  if [ ! -f $SERVER_ENV_FILE ]; then
    cp $SERVER_DIR/deploy/env/nstack.server.env.example $SERVER_ENV_FILE
    echo 'WARNING: Created server env from example. Review and fill secrets!' >&2
  fi

  # Ensure HTTPS env
  bash $SERVER_DIR/deploy/scripts/ensure_https_env.sh $SERVER_ENV_FILE

  # Bootstrap data dirs
  NS_DATA_ROOT_VAL=\$(grep -E '^NS_DATA_ROOT=' $SERVER_ENV_FILE | tail -n 1 | sed 's/^[^=]*=//' || echo '/data/neurostack')
  export LA_DATA_ROOT=\"\$NS_DATA_ROOT_VAL\"
  sudo mkdir -p \$NS_DATA_ROOT_VAL
  sudo chown -R mzk-12-10:\$(id -gn) \$NS_DATA_ROOT_VAL || true
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/bootstrap_data_dirs.sh \$NS_DATA_ROOT_VAL

  # Bootstrap TLS
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/bootstrap_extra_ca.sh

  # Start platform (Layer 1)
  ENV_FILE=$SERVER_ENV_FILE \
    docker compose -f $SERVER_DIR/$NS_COMPOSE_DIR/layer1-platform/docker-compose.yml up -d

  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh \
    neurostack-platform postgres-primary 180
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh \
    neurostack-platform redis 180

  # Bootstrap OpenClaw
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/bootstrap_openclaw.sh

  # Load images
  echo 'Loading app images...'
  gzip -dc $remote_tmp/app_images.tar.gz | docker load

  # Start OmniRouter first
  ENV_FILE=$SERVER_ENV_FILE \
    docker compose -f $SERVER_DIR/$NS_COMPOSE_DIR/layer2-apps/docker-compose.yml \
    up -d --no-deps omnirouter

  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh \
    neurostack-apps omnirouter 420

  # Provision API keys
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/bootstrap_app_clients.sh

  # Start remaining apps
  ENV_FILE=$SERVER_ENV_FILE \
    docker compose -f $SERVER_DIR/$NS_COMPOSE_DIR/layer2-apps/docker-compose.yml \
    up -d --no-deps open-webui openclaw-gateway openclaw-cli

  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh \
    neurostack-apps open-webui 300
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh \
    neurostack-apps openclaw-gateway 300

  rm -rf $remote_tmp
  echo 'Remote deploy complete'
"

# ──────────────────────────────────────────────────────
# [5] Remote healthcheck
# ──────────────────────────────────────────────────────
echo "[5/6] Remote healthcheck..."
"${SSH_BASE[@]}" "$SERVER_REMOTE" \
  "ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/healthcheck.sh server"

# ──────────────────────────────────────────────────────
# [6] Remote smoke test
# ──────────────────────────────────────────────────────
echo "[6/6] Remote smoke test..."
"${SSH_BASE[@]}" "$SERVER_REMOTE" \
  "ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/smoke_stack.sh server"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║      NeuroStack Server Deploy Complete ✓          ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  OmniRouter : https://router.nstack.server:8444  ║"
echo "║  OpenWebUI  : https://chat.nstack.server:8444    ║"
echo "║  OpenClaw   : https://claw.nstack.server:8444    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Add to /etc/hosts on client machines:"
echo "  192.168.1.65  router.nstack.server api.nstack.server"
echo "  192.168.1.65  chat.nstack.server claw.nstack.server"
echo "  192.168.1.65  s3.nstack.server minio.nstack.server traefik.nstack.server"
