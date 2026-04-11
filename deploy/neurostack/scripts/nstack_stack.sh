#!/usr/bin/env bash
# NeuroStack stack.sh — wrapper tương tự deploy/scripts/stack.sh
# Dùng cho neurostack brand: neurostack_platform, neurostack_apps
# Usage:
#   ENV_FILE=deploy/env/nstack.local.env bash deploy/neurostack/scripts/nstack_stack.sh platform up -d
#   ENV_FILE=deploy/env/nstack.local.env bash deploy/neurostack/scripts/nstack_stack.sh apps up -d
set -euo pipefail

NEUROSTACK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd -- "$NEUROSTACK_DIR/../.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/nstack.local.env}"

platform_compose="$NEUROSTACK_DIR/layer1-platform/docker-compose.yml"
apps_compose="$NEUROSTACK_DIR/layer2-apps/docker-compose.yml"

usage() {
  cat >&2 <<EOF
Usage:
  $0 platform <docker compose args...>
  $0 apps <docker compose args...>

Examples:
  $0 platform up -d
  $0 apps up -d
  $0 apps up -d --no-deps omnirouter
  $0 apps up -d --no-deps open-webui
  $0 apps up -d --no-deps openclaw-gateway openclaw-cli

Env:
  ENV_FILE=/path/to/nstack.local.env  (default: deploy/env/nstack.local.env)
EOF
}

if [[ "${1:-}" != "platform" && "${1:-}" != "apps" ]]; then
  usage
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Create it from: deploy/env/nstack.local.env.example" >&2
  exit 1
fi

# Read NS_DATA_ROOT and expose as LA_DATA_ROOT for compatibility with bootstrap scripts
ns_data_root="$(grep -E '^NS_DATA_ROOT=' "$ENV_FILE" | tail -n 1 | sed 's/^[^=]*=//' || true)"
if [[ -n "$ns_data_root" ]]; then
  export LA_DATA_ROOT="$ns_data_root"
fi

# Read OMNIROUTER_HOST and expose as OMNIROUTE_HOST for compatibility with render_traefik_dynamic.sh
omnirouter_host="$(grep -E '^OMNIROUTER_HOST=' "$ENV_FILE" | tail -n 1 | sed 's/^[^=]*=//' || true)"
omnirouter_api_host="$(grep -E '^OMNIROUTER_API_HOST=' "$ENV_FILE" | tail -n 1 | sed 's/^[^=]*=//' || true)"
if [[ -n "$omnirouter_host" ]]; then
  export OMNIROUTE_HOST="$omnirouter_host"
fi
if [[ -n "$omnirouter_api_host" ]]; then
  export OMNIROUTE_API_HOST="$omnirouter_api_host"
fi

target="$1"
shift

if [[ "$target" == "apps" && "${1:-}" == "pull" ]]; then
  echo "Remote image pulls are disabled for neurostack-apps." >&2
  echo "Build images from source via ops/nstack_deploy_local.sh or ops/nstack_deploy_server.sh." >&2
  exit 2
fi

case "$target" in
  platform)
    # Bootstrap TLS for NeuroStack (uses NS_DATA_ROOT via LA_DATA_ROOT alias)
    ENV_FILE="$ENV_FILE" bash "$DEPLOY_DIR/scripts/bootstrap_tls.sh"
    # Render Traefik dynamic config for NeuroStack nstack.* domains
    ENV_FILE="$ENV_FILE" bash "$NEUROSTACK_DIR/scripts/render_nstack_traefik_dynamic.sh"
    exec docker compose --env-file "$ENV_FILE" -f "$platform_compose" "$@"
    ;;
  apps)
    exec docker compose --env-file "$ENV_FILE" -f "$apps_compose" "$@"
    ;;
esac
