#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat >&2 <<'EOF'
Usage:
  # LocalAgent brand (Codex agent stack)
  ops/agent.sh deploy local
  ops/agent.sh deploy server

  # NeuroStack brand (new isolated brand)
  ops/agent.sh deploy nstack-local
  ops/agent.sh deploy nstack-server

Env — LocalAgent brand:
  LOCAL_ENV_FILE=...         (default: deploy/env/stack.local.env)
  SERVER_REMOTE=user@host    (default: mzk-12-10@100.101.77.8)
  SERVER_DIR=/path           (default: ~/localagent)
  SERVER_ENV_FILE=/path      (default: ~/localagent/deploy/env/stack.env)
  SERVER_SSH_KEY=/path       (preferred for server deploy)
  SERVER_SSH_PASS=...        (optional fallback if password auth)
  SERVER_STRICT_HOST_KEY_CHECKING=accept-new|yes|no

Env — NeuroStack brand:
  NS_ENV_FILE=...            (default: deploy/env/nstack.local.env)
  SERVER_REMOTE=user@host    (default: mzk-12-10@100.101.77.8)
  SERVER_DIR=/path           (default: /home/mzk-12-10/neurostack)
  SERVER_ENV_FILE=/path      (default: /home/mzk-12-10/neurostack/deploy/env/nstack.server.env)
  SERVER_SSH_PASS=...        (required if password auth)
EOF
}

if [[ "${1:-}" != "deploy" ]]; then
  usage
  exit 2
fi

target="${2:-}"

case "$target" in
  local)
    "$ROOT_DIR/ops/deploy_local.sh"
    ;;
  server)
    "$ROOT_DIR/ops/deploy_server.sh"
    ;;
  nstack-local)
    "$ROOT_DIR/ops/nstack_deploy_local.sh"
    ;;
  nstack-server)
    "$ROOT_DIR/ops/nstack_deploy_server.sh"
    ;;
  *)
    usage
    exit 2
    ;;
esac
