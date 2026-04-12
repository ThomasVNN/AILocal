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
if [[ -z "$OPENCLAW_HOST" ]]; then
  OPENCLAW_HOST="openclaw.localagent.local"
fi

TRAEFIK_TLS_ENABLED="${TRAEFIK_TLS_ENABLED:-$(read_env_value TRAEFIK_TLS_ENABLED || true)}"
TRAEFIK_HTTPS_PORT="${TRAEFIK_HTTPS_PORT:-$(read_env_value TRAEFIK_HTTPS_PORT || true)}"
OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH="${OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH:-$(read_env_value OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH || true)}"
if [[ -z "$TRAEFIK_HTTPS_PORT" ]]; then
  TRAEFIK_HTTPS_PORT="443"
fi
TRAEFIK_EDGE_IP=""
traefik_container_id="$(
  docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/layer1-platform/docker-compose.yml" ps -q traefik 2>/dev/null || true
)"
if [[ -n "$traefik_container_id" ]]; then
  # Try neurostack_edge first (NeuroStack brand), then localagent_edge (legacy)
  for net in neurostack_edge localagent_edge; do
    TRAEFIK_EDGE_IP="$(
      docker inspect -f "{{with index .NetworkSettings.Networks \"${net}\"}}{{.IPAddress}}{{end}}" "$traefik_container_id" 2>/dev/null || true
    )"
    if [[ -n "$TRAEFIK_EDGE_IP" ]]; then
      break
    fi
  done
fi
if [[ -z "$TRAEFIK_EDGE_IP" ]]; then
  TRAEFIK_EDGE_IP="${TRAEFIK_EDGE_IP:-$(read_env_value TRAEFIK_EDGE_IP || true)}"
fi
if [[ -z "$TRAEFIK_EDGE_IP" ]]; then
  TRAEFIK_EDGE_IP="172.23.0.2"
fi

LA_DATA_ROOT="${LA_DATA_ROOT:-$(read_env_value LA_DATA_ROOT || true)}"
if [[ -z "$LA_DATA_ROOT" ]]; then
  LA_DATA_ROOT="/data/localagent"
fi

CONFIG_FILE="$LA_DATA_ROOT/apps/openclaw/config/openclaw.json"

https_origin_suffix=""
if [[ "$TRAEFIK_HTTPS_PORT" != "443" ]]; then
  https_origin_suffix=":$TRAEFIK_HTTPS_PORT"
fi

desired_https="https://$OPENCLAW_HOST$https_origin_suffix"
if [[ "$TRAEFIK_TLS_ENABLED" =~ ^(1|true|TRUE|True|yes|YES|on|ON)$ ]]; then
  desired_origins="$(printf '[\"%s\"]' "$desired_https")"
else
  desired_http="http://$OPENCLAW_HOST"
  desired_origins="$(printf '[\"%s\",\"%s\"]' "$desired_http" "$desired_https")"
fi

desired_trusted_proxies="$(printf '[\"%s/32\"]' "$TRAEFIK_EDGE_IP")"
if [[ "$OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH" =~ ^(1|true|TRUE|True|yes|YES|on|ON)$ ]]; then
  desired_disable_device_auth="true"
else
  desired_disable_device_auth="false"
fi

echo "Bootstrapping OpenClaw Control UI allowedOrigins -> $desired_origins"
echo "Bootstrapping OpenClaw gateway.trustedProxies -> $desired_trusted_proxies"
echo "Bootstrapping OpenClaw Control UI device auth -> $desired_disable_device_auth"
echo "Resolved Traefik edge IP: $TRAEFIK_EDGE_IP"
echo "Config file: $CONFIG_FILE"

bash "$DEPLOY_DIR/scripts/stack.sh" apps run --rm --no-deps --entrypoint node \
  openclaw-gateway dist/index.js config set gateway.controlUi.allowedOrigins \
  "$desired_origins" --strict-json

bash "$DEPLOY_DIR/scripts/stack.sh" apps run --rm --no-deps --entrypoint node \
  openclaw-gateway dist/index.js config set gateway.trustedProxies \
  "$desired_trusted_proxies" --strict-json

bash "$DEPLOY_DIR/scripts/stack.sh" apps run --rm --no-deps --entrypoint node \
  openclaw-gateway dist/index.js config set gateway.controlUi.dangerouslyDisableDeviceAuth \
  "$desired_disable_device_auth" --strict-json

echo "Done. Restart the gateway to apply:"
echo "  bash \"$DEPLOY_DIR/scripts/stack.sh\" apps up -d --no-deps openclaw-gateway"
echo "Control UI helper:"
echo "  ENV_FILE=\"$ENV_FILE\" bash \"$DEPLOY_DIR/scripts/openclaw_dashboard.sh\""
