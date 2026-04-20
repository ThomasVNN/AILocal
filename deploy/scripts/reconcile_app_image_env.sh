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

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$env_file" 2>/dev/null | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

resolve_value() {
  local key="$1"
  local default_value="${2:-}"
  local current_value="${!key:-}"
  if [[ -n "$current_value" ]]; then
    printf '%s' "$current_value"
    return 0
  fi
  current_value="$(read_env_value "$key" || true)"
  if [[ -n "$current_value" ]]; then
    printf '%s' "$current_value"
    return 0
  fi
  printf '%s' "$default_value"
}

normalize_bool() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|y|on) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

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

set_platform_source_images() {
  env_set "POSTGRES_IMAGE" "postgres:16-alpine"
  env_set "POSTGRES_BACKUP_IMAGE" "prodrigestivill/postgres-backup-local:16"
  env_set "REDIS_IMAGE" "redis:7-alpine"
  env_set "MINIO_IMAGE" "minio/minio:RELEASE.2025-09-07T16-13-09Z"
  env_set "MINIO_MC_IMAGE" "minio/mc:RELEASE.2025-08-13T08-35-41Z"
  env_set "TRAEFIK_IMAGE" "traefik:v3.1"
}

set_platform_registry_images() {
  local registry="$1"
  local namespace="$2"

  env_set "POSTGRES_IMAGE" "${registry}/${namespace}/postgres:16-alpine"
  env_set "POSTGRES_BACKUP_IMAGE" "${registry}/${namespace}/postgres-backup-local:16"
  env_set "REDIS_IMAGE" "${registry}/${namespace}/redis:7-alpine"
  env_set "MINIO_IMAGE" "${registry}/${namespace}/minio:RELEASE.2025-09-07T16-13-09Z"
  env_set "MINIO_MC_IMAGE" "${registry}/${namespace}/mc:RELEASE.2025-08-13T08-35-41Z"
  env_set "TRAEFIK_IMAGE" "${registry}/${namespace}/traefik:v3.1"
}

set_app_registry_images() {
  local registry="$1"
  local namespace="$2"
  local tag="$3"

  env_set "OMNIROUTE_IMAGE" "${registry}/${namespace}/omniroute:${tag}"
  env_set "OPENWEBUI_IMAGE" "${registry}/${namespace}/open-webui:${tag}"
  env_set "OPENCLAW_IMAGE" "${registry}/${namespace}/openclaw:${tag}"
}

registry_enabled="$(normalize_bool "$(resolve_value LOCALAGENT_USE_REGISTRY_IMAGES false)")"
registry="$(resolve_value LOCALAGENT_IMAGE_REGISTRY 'mizuk1210.mulley-ray.ts.net:9999')"
registry="${registry%/}"
platform_namespace="$(resolve_value LOCALAGENT_PLATFORM_NAMESPACE 'localagent-platform')"
apps_namespace="$(resolve_value LOCALAGENT_APPS_NAMESPACE 'localagent-apps')"
image_tag="$(resolve_value LOCALAGENT_IMAGE_TAG 'dev')"

case "$mode" in
  local)
    env_set "OMNIROUTE_PLATFORM" "linux/arm64"
    env_set "OPENWEBUI_PLATFORM" "linux/arm64"
    env_set "OPENCLAW_PLATFORM" "linux/arm64"
    if [[ "$registry_enabled" == "true" ]]; then
      set_app_registry_images "$registry" "$apps_namespace" "$image_tag"
    else
      env_set "OMNIROUTE_IMAGE" "omniroute:local"
      env_set "OPENWEBUI_IMAGE" "open-webui:local"
      env_set "OPENCLAW_IMAGE" "openclaw:local"
    fi
    ;;
  server)
    env_set "OMNIROUTE_PLATFORM" "linux/amd64"
    env_set "OPENWEBUI_PLATFORM" "linux/amd64"
    env_set "OPENCLAW_PLATFORM" "linux/amd64"
    if [[ "$registry_enabled" == "true" ]]; then
      set_app_registry_images "$registry" "$apps_namespace" "$image_tag"
    else
      env_set "OMNIROUTE_IMAGE" "omniroute:intel"
      env_set "OPENWEBUI_IMAGE" "open-webui:intel"
      env_set "OPENCLAW_IMAGE" "openclaw:intel"
    fi
    ;;
  *)
    echo "Unsupported mode: $mode" >&2
    exit 2
    ;;
esac

if [[ "$registry_enabled" == "true" ]]; then
  env_set "LOCALAGENT_USE_REGISTRY_IMAGES" "true"
  env_set "LOCALAGENT_IMAGE_REGISTRY" "$registry"
  env_set "LOCALAGENT_PLATFORM_NAMESPACE" "$platform_namespace"
  env_set "LOCALAGENT_APPS_NAMESPACE" "$apps_namespace"
  env_set "LOCALAGENT_IMAGE_TAG" "$image_tag"
  env_set "APP_PULL_POLICY" "$(resolve_value LOCALAGENT_APP_PULL_POLICY 'missing')"
  set_platform_registry_images "$registry" "$platform_namespace"
else
  env_set "LOCALAGENT_USE_REGISTRY_IMAGES" "false"
  env_set "APP_PULL_POLICY" "never"
  set_platform_source_images
fi

env_set "OPENWEBUI_BUILD_USE_SLIM" "true"
env_set "OPENWEBUI_BUILD_USE_OLLAMA" "false"
env_set "OPENWEBUI_BUILD_USE_PERMISSION_HARDENING" "false"
env_set "OPENWEBUI_BUILD_HASH" "localagent-source"
env_set "OPENCLAW_BUILD_VARIANT" "$(resolve_value OPENCLAW_BUILD_VARIANT 'slim')"
env_set "OPENCLAW_BUILD_APT_UPGRADE" "$(resolve_value OPENCLAW_BUILD_APT_UPGRADE '0')"
