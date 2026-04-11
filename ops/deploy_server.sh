#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

SERVER_REMOTE="${SERVER_REMOTE:-mzk-12-10@100.101.77.8}"
SERVER_DIR="${SERVER_DIR:-~/localagent}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$SERVER_DIR/deploy/env/stack.env}"

if [[ -z "${SERVER_SSH_PASS:-}" ]]; then
  echo "Missing SERVER_SSH_PASS (server currently uses password SSH auth)." >&2
  echo "Example:" >&2
  echo "  SERVER_SSH_PASS='***' ops/agent.sh deploy server" >&2
  exit 2
fi

SSH_BASE=(sshpass -p "$SERVER_SSH_PASS" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
SCP_BASE=(sshpass -p "$SERVER_SSH_PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)

echo "[1/5] Review OmniRoute workspace"
git -C "$ROOT_DIR/OmniRoute" status --porcelain || true
git -C "$ROOT_DIR/OmniRoute" log -1 --oneline || true

echo "[2/5] Build amd64 OmniRoute image"
docker buildx build \
  --platform linux/amd64 \
  -t omniroute:intel \
  -f "$ROOT_DIR/OmniRoute/Dockerfile" \
  "$ROOT_DIR/OmniRoute" \
  --target runner-base \
  --load

tmp_tar="$(mktemp -t omniroute-intel.XXXXXX.tar.gz)"
trap 'rm -f "$tmp_tar"' EXIT
docker save omniroute:intel | gzip -c >"$tmp_tar"

echo "[3/5] Sync deploy/ (no secrets) + upload image tar"
rsync -av \
  --exclude 'env/stack.env' \
  --exclude '.DS_Store' \
  -e "sshpass -p \"$SERVER_SSH_PASS\" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" \
  "$ROOT_DIR/deploy/" \
  "$SERVER_REMOTE:$SERVER_DIR/deploy/"

remote_tmp="\$HOME/.localagent_tmp"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "mkdir -p $remote_tmp"
"${SCP_BASE[@]}" "$tmp_tar" "$SERVER_REMOTE:$remote_tmp/omniroute_intel_amd64.tar.gz"

echo "[4/5] Ensure HTTPS env + restart platform/OpenClaw/OmniRoute/OpenWebUI"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "set -euo pipefail; cd $SERVER_DIR; bash deploy/scripts/ensure_https_env.sh $SERVER_ENV_FILE; bash deploy/scripts/bootstrap_data_dirs.sh; ENV_FILE=$SERVER_ENV_FILE bash deploy/scripts/bootstrap_extra_ca.sh; ENV_FILE=$SERVER_ENV_FILE bash deploy/scripts/stack.sh platform up -d; ENV_FILE=$SERVER_ENV_FILE bash deploy/scripts/bootstrap_openclaw.sh; gzip -dc $remote_tmp/omniroute_intel_amd64.tar.gz | docker load; rm -rf $remote_tmp; ENV_FILE=$SERVER_ENV_FILE bash deploy/scripts/stack.sh apps up -d --no-deps omniroute open-webui openclaw-gateway; ENV_FILE=$SERVER_ENV_FILE bash deploy/scripts/bootstrap_app_clients.sh"

echo "[5/6] Healthcheck"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "set -euo pipefail; cd $SERVER_DIR; ENV_FILE=$SERVER_ENV_FILE bash deploy/scripts/healthcheck.sh server"

echo "[6/6] Smoke test"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "set -euo pipefail; cd $SERVER_DIR; ENV_FILE=$SERVER_ENV_FILE bash deploy/scripts/smoke_stack.sh server"

echo "OK: server deploy complete (platform + OpenClaw + OmniRoute reconciled)."
