#!/usr/bin/env bash
# deploy/lib/common.sh — Shared utility functions for LocalAgent / NeuroStack deploy scripts
# Source this file: source "$DEPLOY_DIR/lib/common.sh"
#
# Functions provided:
#   read_env_value KEY          — read a key from $ENV_FILE
#   set_env_value KEY VALUE     — set/update a key in $ENV_FILE
#   normalize_bool VALUE        — return 0 if truthy, 1 otherwise
#   rand_hex BYTES              — generate random hex string
#   rand_b64 BYTES              — generate random base64 string
#   smoke_check NAME URL        — quick HTTP smoke test
#   wait_for_container SERVICE_CONTAINER TIMEOUT_SECONDS — wait for healthy

# ===========================================================================
#  Env file helpers
# ===========================================================================

# Read a value from $ENV_FILE by key.
# Handles simple KEY=VALUE lines (no multiline, no quoting).
# Returns 1 if key not found.
read_env_value() {
  local key="$1"
  local env_file="${ENV_FILE:?ENV_FILE not set}"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$env_file" 2>/dev/null | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  local value="${line#*=}"
  # Strip surrounding quotes if present
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

# Set or update a key in $ENV_FILE.
# Replaces the first occurrence; appends if not found.
set_env_value() {
  local key="$1" value="$2"
  local env_file="${ENV_FILE:?ENV_FILE not set}"
  local tmp_file
  tmp_file="$(mktemp "${env_file}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { prefix = key "="; replaced = 0; }
    index($0, prefix) == 1 && replaced == 0 { print prefix value; replaced = 1; next; }
    { print $0; }
    END { if (replaced == 0) { print prefix value; } }
  ' "$env_file" > "$tmp_file"
  mv "$tmp_file" "$env_file"
}

# ===========================================================================
#  Boolean / type helpers
# ===========================================================================

# Return 0 (true) if the value is truthy, 1 (false) otherwise.
normalize_bool() {
  case "${1:-}" in
    1|true|TRUE|True|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

# ===========================================================================
#  Random generators
# ===========================================================================

rand_hex() {
  openssl rand -hex "$1" 2>/dev/null \
    || python3 -c "import secrets,sys;print(secrets.token_hex(int(sys.argv[1])))" "$1"
}

rand_b64() {
  openssl rand -base64 "$1" 2>/dev/null | tr -d '\n' \
    || python3 -c "import base64,os,sys;print(base64.b64encode(os.urandom(int(sys.argv[1]))).decode())" "$1"
}

# ===========================================================================
#  Network / HTTP helpers
# ===========================================================================

# Quick HTTP smoke test.
# Usage: smoke_check "Component Name" "https://host:port/path"
smoke_check() {
  local name="$1" url="$2"
  local code
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo '000')"
  if [[ "$code" =~ ^[23] ]]; then
    echo "  ✓ $name ($code)"
    return 0
  else
    echo "  ⚠ $name - HTTP $code (may need CA trust or service to warm up)"
    return 1
  fi
}

# ===========================================================================
#  Docker helpers
# ===========================================================================

# Resolve the Docker network name for the current brand.
# Usage: resolve_edge_network [brand]
#   brand: "localagent" (default) or "neurostack"
resolve_edge_network() {
  local brand="${1:-localagent}"
  printf '%s_edge' "$brand"
}

resolve_platform_network() {
  local brand="${1:-localagent}"
  printf '%s_platform' "$brand"
}

# Get the IP of traefik container on the edge network.
# Usage: get_traefik_edge_ip COMPOSE_FILE EDGE_NETWORK [FALLBACK_IP]
get_traefik_edge_ip() {
  local compose_file="$1"
  local edge_network="$2"
  local fallback="${3:-172.24.0.2}"

  local container_id
  container_id="$(
    docker compose --env-file "${ENV_FILE:?}" -f "$compose_file" ps -q traefik 2>/dev/null || true
  )"

  if [[ -n "$container_id" ]]; then
    local ip
    ip="$(
      docker inspect -f "{{with index .NetworkSettings.Networks \"${edge_network}\"}}{{.IPAddress}}{{end}}" \
        "$container_id" 2>/dev/null || true
    )"
    if [[ -n "$ip" ]]; then
      printf '%s' "$ip"
      return 0
    fi
  fi

  printf '%s' "$fallback"
}
