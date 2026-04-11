#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  cat >&2 <<'EOF'
Usage:
  reconcile_app_image_env.sh <local|server> <env-file>
EOF
  exit 2
fi

mode="$1"
env_file="$2"

if [[ ! -f "$env_file" ]]; then
  echo "Missing env file: $env_file" >&2
  exit 1
fi

env_set() {
  local key="$1"
  local value="$2"
  local tmp_file
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/localagent-env.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN {
      prefix = key "="
      replaced = 0
    }
    index($0, prefix) == 1 && replaced == 0 {
      print prefix value
      replaced = 1
      next
    }
    { print }
    END {
      if (replaced == 0) {
        print prefix value
      }
    }
  ' "$env_file" > "$tmp_file"
  mv "$tmp_file" "$env_file"
}

case "$mode" in
  local)
    env_set "OMNIROUTE_IMAGE" "omniroute:local"
    env_set "OMNIROUTE_PLATFORM" "linux/arm64"
    env_set "OPENWEBUI_IMAGE" "open-webui:local"
    env_set "OPENWEBUI_PLATFORM" "linux/arm64"
    env_set "OPENCLAW_IMAGE" "openclaw:local"
    env_set "OPENCLAW_PLATFORM" "linux/arm64"
    ;;
  server)
    env_set "OMNIROUTE_IMAGE" "omniroute:intel"
    env_set "OMNIROUTE_PLATFORM" "linux/amd64"
    env_set "OPENWEBUI_IMAGE" "open-webui:intel"
    env_set "OPENWEBUI_PLATFORM" "linux/amd64"
    env_set "OPENCLAW_IMAGE" "openclaw:intel"
    env_set "OPENCLAW_PLATFORM" "linux/amd64"
    ;;
  *)
    echo "Unsupported mode: $mode" >&2
    exit 2
    ;;
esac

env_set "OPENWEBUI_BUILD_USE_SLIM" "true"
env_set "OPENWEBUI_BUILD_USE_OLLAMA" "false"
env_set "OPENWEBUI_BUILD_USE_PERMISSION_HARDENING" "false"
env_set "OPENWEBUI_BUILD_HASH" "localagent-source"
