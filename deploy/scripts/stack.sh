#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"

platform_compose="$DEPLOY_DIR/layer1-platform/docker-compose.yml"
apps_compose="$DEPLOY_DIR/layer2-apps/docker-compose.yml"

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

normalize_bool() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|y|on) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

usage() {
  cat >&2 <<EOF
Usage:
  $0 platform <docker compose args...>
  $0 apps <docker compose args...>

Examples:
  $0 platform up -d
  $0 apps up -d
  $0 apps build omniroute open-webui openclaw-gateway
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

if [[ "$target" == "apps" && "${1:-}" == "pull" ]]; then
  registry_images_enabled="$(normalize_bool "$(read_env_value LOCALAGENT_USE_REGISTRY_IMAGES || true)")"
  app_pull_allowed="$(normalize_bool "${LOCALAGENT_ALLOW_APP_PULL:-false}")"
  if [[ "$registry_images_enabled" != "true" && "$app_pull_allowed" != "true" ]]; then
    echo "Remote image pulls are disabled for layer2-apps unless registry images are enabled." >&2
    echo "Build app images from workspace source via ops/deploy_local.sh, ops/deploy_server.sh, or deploy/scripts/build_app_images.sh." >&2
    exit 2
  fi
fi

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
