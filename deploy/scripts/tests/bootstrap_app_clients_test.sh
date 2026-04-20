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

assert_not_contains() {
  local needle="$1"
  local haystack="$2"
  local message="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "ASSERT_NOT_CONTAINS failed: $message" >&2
    echo "  unexpected substring: $needle" >&2
    exit 1
  fi
}

test_bootstrap_avoids_host_node_dependency() {
  local script
  script="$(<"$ROOT_DIR/deploy/scripts/bootstrap_app_clients.sh")"

  assert_not_contains \
    "node -e" \
    "$script" \
    "bootstrap_app_clients should not require host node just to serialize JSON values"

  assert_not_contains \
    'node - "$OPENCLAW_CONFIG_FILE"' \
    "$script" \
    "bootstrap_app_clients should not require host node to write OpenClaw config"

  assert_contains \
    "json_string_array" \
    "$script" \
    "OpenWebUI Redis JSON arrays should be serialized without host node"

  assert_contains \
    "apps run --rm --no-deps --entrypoint node openclaw-gateway" \
    "$script" \
    "OpenClaw config reconciliation should run inside the OpenClaw runtime image"
}

test_bootstrap_does_not_write_literal_openclaw_token() {
  local script
  script="$(<"$ROOT_DIR/deploy/scripts/bootstrap_app_clients.sh")"

  assert_not_contains \
    'config.gateway.auth.token = "${OPENCLAW_GATEWAY_TOKEN}"' \
    "$script" \
    "OpenClaw config should receive the actual gateway token, not a literal shell placeholder"
}

main() {
  test_bootstrap_avoids_host_node_dependency
  test_bootstrap_does_not_write_literal_openclaw_token
  echo "bootstrap_app_clients_test: ok"
}

main "$@"
