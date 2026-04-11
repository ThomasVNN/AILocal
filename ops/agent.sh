#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat >&2 <<'EOF'
Usage:
  ops/agent.sh deploy local
  ops/agent.sh deploy server

Env (optional):
  LOCAL_ENV_FILE=...         (default: deploy/env/stack.local.env)
  SERVER_REMOTE=user@host    (default: mzk-12-10@100.101.77.8)
  SERVER_DIR=/path           (default: ~/localagent)
  SERVER_ENV_FILE=/path      (default: ~/localagent/deploy/env/stack.env)
  SERVER_SSH_PASS=...        (required if server uses password login and you don't have SSH key auth)
EOF
}

if [[ "${1:-}" != "deploy" ]]; then
  usage
  exit 2
fi

target="${2:-}"
if [[ "$target" != "local" && "$target" != "server" ]]; then
  usage
  exit 2
fi

case "$target" in
  local)
    "$ROOT_DIR/ops/deploy_local.sh"
    ;;
  server)
    "$ROOT_DIR/ops/deploy_server.sh"
    ;;
esac
