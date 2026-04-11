#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Create it first:" >&2
  echo "  cp \"$DEPLOY_DIR/env/stack.env.example\" \"$ENV_FILE\"" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

OPENCLAW_HOST="${OPENCLAW_HOST:-$(read_env_value OPENCLAW_HOST || true)}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(read_env_value OPENCLAW_GATEWAY_TOKEN || true)}"
TRAEFIK_TLS_ENABLED="${TRAEFIK_TLS_ENABLED:-$(read_env_value TRAEFIK_TLS_ENABLED || true)}"
TRAEFIK_HTTPS_PORT="${TRAEFIK_HTTPS_PORT:-$(read_env_value TRAEFIK_HTTPS_PORT || true)}"

if [[ -z "$OPENCLAW_HOST" ]]; then
  OPENCLAW_HOST="openclaw.localagent.local"
fi
if [[ -z "$TRAEFIK_HTTPS_PORT" ]]; then
  TRAEFIK_HTTPS_PORT="443"
fi

CONTROL_UI_BASE_PATH="$(
  bash "$DEPLOY_DIR/scripts/stack.sh" apps exec -T openclaw-gateway node dist/index.js config get gateway.controlUi.basePath \
    2>/dev/null | tail -n 1 || true
)"
CONTROL_UI_BASE_PATH="${CONTROL_UI_BASE_PATH%\"}"
CONTROL_UI_BASE_PATH="${CONTROL_UI_BASE_PATH#\"}"
if [[ -n "$CONTROL_UI_BASE_PATH" && "$CONTROL_UI_BASE_PATH" != /* ]]; then
  CONTROL_UI_BASE_PATH="/$CONTROL_UI_BASE_PATH"
fi
if [[ -z "$CONTROL_UI_BASE_PATH" || "$CONTROL_UI_BASE_PATH" == "undefined" ]]; then
  CONTROL_UI_BASE_PATH=""
fi

scheme="https"
port_suffix=""
if [[ "$TRAEFIK_TLS_ENABLED" =~ ^(0|false|FALSE|False|no|NO|off|OFF)$ ]]; then
  scheme="http"
fi
if [[ "$scheme" == "https" && "$TRAEFIK_HTTPS_PORT" != "443" ]]; then
  port_suffix=":$TRAEFIK_HTTPS_PORT"
fi

ui_path="/"
if [[ -n "$CONTROL_UI_BASE_PATH" ]]; then
  ui_path="${CONTROL_UI_BASE_PATH%/}/"
fi

dashboard_url="${scheme}://${OPENCLAW_HOST}${port_suffix}${ui_path}"
if [[ -n "$OPENCLAW_GATEWAY_TOKEN" ]]; then
  dashboard_url="${dashboard_url}#token=${OPENCLAW_GATEWAY_TOKEN}"
fi

echo "Dashboard URL: $dashboard_url"
