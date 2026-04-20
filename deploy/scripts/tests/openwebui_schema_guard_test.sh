#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../openwebui_schema_guard.sh"

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "ASSERT_EQ failed: $message" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    exit 1
  fi
}

create_migration() {
  local dir="$1"
  local revision="$2"
  cat >"$dir/${revision}_migration.py" <<EOF
revision = "$revision"
EOF
}

test_missing_revision_requires_repair() {
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  create_migration "$tmp_dir" "922e7a387820"
  local reason
  reason="$(openwebui_schema_reset_reason "b2c3d4e5f6a7" "$tmp_dir" "1")"
  assert_eq "missing_revision:b2c3d4e5f6a7" "$reason" "missing source revision should trigger reset"
  rm -rf "$tmp_dir"
}

test_missing_tool_access_control_requires_repair() {
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  create_migration "$tmp_dir" "922e7a387820"
  local reason
  reason="$(openwebui_schema_reset_reason "922e7a387820" "$tmp_dir" "0")"
  assert_eq "missing_tool_access_control" "$reason" "tool access_control drift should trigger reset"
  rm -rf "$tmp_dir"
}

test_known_revision_with_required_column_is_accepted() {
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  create_migration "$tmp_dir" "922e7a387820"
  local reason
  reason="$(openwebui_schema_reset_reason "922e7a387820" "$tmp_dir" "1")"
  assert_eq "" "$reason" "current revision with required columns should not reset"
  rm -rf "$tmp_dir"
}

main() {
  test_missing_revision_requires_repair
  test_missing_tool_access_control_requires_repair
  test_known_revision_with_required_column_is_accepted
  echo "openwebui_schema_guard_test: ok"
}

main "$@"
