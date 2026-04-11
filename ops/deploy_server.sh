#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

SERVER_REMOTE="${SERVER_REMOTE:-mzk-12-10@100.101.77.8}"
SERVER_DIR="${SERVER_DIR:-~/localagent}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$SERVER_DIR/deploy/env/stack.env}"
SERVER_SSH_KEY="${SERVER_SSH_KEY:-}"
SERVER_SSH_PASS="${SERVER_SSH_PASS:-}"
SERVER_STRICT_HOST_KEY_CHECKING="${SERVER_STRICT_HOST_KEY_CHECKING:-accept-new}"

SSH_OPTS=(-o "StrictHostKeyChecking=${SERVER_STRICT_HOST_KEY_CHECKING}")
if [[ -n "$SERVER_SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SERVER_SSH_KEY")
fi

if [[ -n "$SERVER_SSH_PASS" ]]; then
  SSH_BASE=(sshpass -p "$SERVER_SSH_PASS" ssh "${SSH_OPTS[@]}")
  SCP_BASE=(sshpass -p "$SERVER_SSH_PASS" scp "${SSH_OPTS[@]}")
else
  SSH_BASE=(ssh "${SSH_OPTS[@]}")
  SCP_BASE=(scp "${SSH_OPTS[@]}")
fi

echo "[1/6] Review workspace state"
git -C "$ROOT_DIR/OmniRoute" log -1 --oneline || true
if ! git -C "$ROOT_DIR/OmniRoute" diff --no-ext-diff --quiet HEAD --; then
  echo "WARN: OmniRoute workspace has tracked changes." >&2
fi

tmp_images="$(mktemp -t localagent-app-images.XXXXXX.tar.gz)"
tmp_deploy="$(mktemp -t localagent-deploy.XXXXXX.tar.gz)"
trap 'rm -f "$tmp_images" "$tmp_deploy"' EXIT

echo "[2/6] Build amd64 app images from workspace source"
OMNIROUTE_IMAGE="omniroute:intel" \
OMNIROUTE_PLATFORM="linux/amd64" \
OPENWEBUI_IMAGE="open-webui:intel" \
OPENWEBUI_PLATFORM="linux/amd64" \
OPENCLAW_IMAGE="openclaw:intel" \
OPENCLAW_PLATFORM="linux/amd64" \
ENV_FILE="$ROOT_DIR/deploy/env/stack.server.env.example" \
  bash "$ROOT_DIR/deploy/scripts/build_app_images.sh" omniroute open-webui openclaw

docker save omniroute:intel open-webui:intel openclaw:intel | gzip -c >"$tmp_images"
tar -C "$ROOT_DIR" \
  --exclude='deploy/env/stack.env' \
  --exclude='deploy/env/stack.local.env' \
  --exclude='.DS_Store' \
  -czf "$tmp_deploy" \
  deploy

remote_tmp="\$HOME/.localagent_tmp"

echo "[3/6] Upload deploy bundle + source-built app images"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "mkdir -p $SERVER_DIR $remote_tmp"
"${SCP_BASE[@]}" "$tmp_deploy" "$SERVER_REMOTE:$remote_tmp/deploy_bundle.tar.gz"
"${SCP_BASE[@]}" "$tmp_images" "$SERVER_REMOTE:$remote_tmp/app_images.tar.gz"

echo "[4/6] Reconcile remote env and rollout platform/app stack"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "set -euo pipefail; \
  mkdir -p $SERVER_DIR; \
  tar -xzf $remote_tmp/deploy_bundle.tar.gz -C $SERVER_DIR; \
  mkdir -p \$(dirname $SERVER_ENV_FILE); \
  if [ ! -f $SERVER_ENV_FILE ]; then cp $SERVER_DIR/deploy/env/stack.server.env.example $SERVER_ENV_FILE; fi; \
  bash $SERVER_DIR/deploy/scripts/reconcile_app_image_env.sh server $SERVER_ENV_FILE; \
  bash $SERVER_DIR/deploy/scripts/ensure_https_env.sh $SERVER_ENV_FILE; \
  LA_DATA_ROOT_VALUE=\$(sed -n 's/^LA_DATA_ROOT=//p' $SERVER_ENV_FILE | tail -n 1); \
  bash $SERVER_DIR/deploy/scripts/bootstrap_data_dirs.sh \${LA_DATA_ROOT_VALUE:-/data/localagent}; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/bootstrap_extra_ca.sh; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/stack.sh platform up -d; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh platform postgres-primary 180; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh platform redis 180; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/bootstrap_openclaw.sh; \
  gzip -dc $remote_tmp/app_images.tar.gz | docker load; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/stack.sh apps up -d --no-deps omniroute; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh apps omniroute 420; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/bootstrap_app_clients.sh; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/stack.sh apps up -d --no-deps openclaw-cli; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh apps open-webui 300; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh apps openclaw-gateway 300; \
  rm -rf $remote_tmp"

echo "[5/6] Healthcheck"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "set -euo pipefail; ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/healthcheck.sh server"

echo "[6/6] Smoke test"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "set -euo pipefail; ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/smoke_stack.sh server"

echo "OK: server deploy complete with source-built OmniRoute, OpenWebUI, and OpenClaw images."
