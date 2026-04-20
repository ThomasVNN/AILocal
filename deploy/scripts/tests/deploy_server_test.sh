#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"

assert_contains() {
  local needle="$1"
  local haystack="$2"
  local message="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "ASSERT_CONTAINS failed: $message" >&2
    echo "  expected substring: $needle" >&2
    exit 1
  fi
}

line_number_for() {
  local needle="$1"
  local file="$2"
  grep -nF "$needle" "$file" | head -n 1 | cut -d: -f1
}

assert_lt() {
  local left="$1"
  local right="$2"
  local message="$3"
  if [[ -z "$left" || -z "$right" || "$left" -ge "$right" ]]; then
    echo "ASSERT_LT failed: $message" >&2
    echo "  left:  ${left:-missing}" >&2
    echo "  right: ${right:-missing}" >&2
    exit 1
  fi
}

test_server_rollout_starts_dependent_apps_before_waiting_for_health() {
  local script_file
  local start_apps_line
  local wait_openwebui_line
  local wait_gateway_line
  local start_cli_line
  script_file="$ROOT_DIR/ops/deploy_server.sh"

  assert_contains \
    "ENV_FILE=\$SERVER_ENV_FILE bash \$SERVER_DIR/deploy/scripts/stack.sh apps up -d --no-build --no-deps open-webui openclaw-gateway; \\" \
    "$(<"$script_file")" \
    "server deploy should start open-webui and openclaw-gateway before waiting for their health"

  assert_contains \
    "ENV_FILE=\$SERVER_ENV_FILE bash \$SERVER_DIR/deploy/scripts/stack.sh apps up -d --no-build --no-deps openclaw-cli; \\" \
    "$(<"$script_file")" \
    "server deploy should still start openclaw-cli after the gateway path is ready"

  start_apps_line="$(line_number_for "ENV_FILE=\$SERVER_ENV_FILE bash \$SERVER_DIR/deploy/scripts/stack.sh apps up -d --no-build --no-deps open-webui openclaw-gateway; \\" "$script_file")"
  wait_openwebui_line="$(line_number_for "ENV_FILE=\$SERVER_ENV_FILE bash \$SERVER_DIR/deploy/scripts/wait_for_service_health.sh apps open-webui 300; \\" "$script_file")"
  wait_gateway_line="$(line_number_for "ENV_FILE=\$SERVER_ENV_FILE bash \$SERVER_DIR/deploy/scripts/wait_for_service_health.sh apps openclaw-gateway 300; \\" "$script_file")"
  start_cli_line="$(line_number_for "ENV_FILE=\$SERVER_ENV_FILE bash \$SERVER_DIR/deploy/scripts/stack.sh apps up -d --no-build --no-deps openclaw-cli; \\" "$script_file")"

  assert_lt "$start_apps_line" "$wait_openwebui_line" "open-webui should be started before its health wait"
  assert_lt "$start_apps_line" "$wait_gateway_line" "openclaw-gateway should be started before its health wait"
  assert_lt "$wait_gateway_line" "$start_cli_line" "openclaw-cli should start after the gateway health gate"
}

main() {
  test_server_rollout_starts_dependent_apps_before_waiting_for_health
  echo "deploy_server_test: ok"
}

main "$@"
