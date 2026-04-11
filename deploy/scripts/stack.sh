#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"

platform_compose="$DEPLOY_DIR/layer1-platform/docker-compose.yml"
apps_compose="$DEPLOY_DIR/layer2-apps/docker-compose.yml"

usage() {
  cat >&2 <<EOF
Usage:
  $0 platform <docker compose args...>
  $0 apps <docker compose args...>

Examples:
  $0 platform up -d
  $0 apps up -d
  $0 apps pull open-webui
  $0 apps up -d --no-deps open-webui

Env:
  ENV_FILE=/path/to/stack.env  (default: $DEPLOY_DIR/env/stack.env)
EOF
}

if [[ "${1:-}" != "platform" && "${1:-}" != "apps" ]]; then
  usage
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Create it first:" >&2
  echo "  cp \"$DEPLOY_DIR/env/stack.env.example\" \"$ENV_FILE\"" >&2
  exit 1
fi

target="$1"
shift

case "$target" in
  platform)
    ENV_FILE="$ENV_FILE" bash "$DEPLOY_DIR/scripts/bootstrap_tls.sh"
    ENV_FILE="$ENV_FILE" bash "$DEPLOY_DIR/scripts/render_traefik_dynamic.sh"
    exec docker compose --env-file "$ENV_FILE" -f "$platform_compose" "$@"
    ;;
  apps)
    exec docker compose --env-file "$ENV_FILE" -f "$apps_compose" "$@"
    ;;
esac
