#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${1:-$DEPLOY_DIR/env/stack.env}}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
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

la_data_root="$(read_env_value LA_DATA_ROOT || echo /data/localagent)"
target_dir="$la_data_root/platform/proxy/extra-ca"
target_file="$target_dir/extra-ca.pem"

mkdir -p "$target_dir"

source_file="$(read_env_value EXTRA_CA_SOURCE_FILE || true)"

if [[ -z "$source_file" && "$(uname -s)" == "Darwin" ]]; then
  candidate="$HOME/Library/Application Support/Charles/ca/charles-proxy-ssl-proxying-certificate.pem"
  if [[ -f "$candidate" ]]; then
    source_file="$candidate"
  fi
fi

if [[ -n "$source_file" && -f "$source_file" ]]; then
  cp "$source_file" "$target_file"
  chmod 644 "$target_file"
  echo "Installed extra CA bundle: $target_file <- $source_file"
else
  : > "$target_file"
  chmod 644 "$target_file"
  echo "No extra CA source detected; using empty bundle: $target_file"
fi
