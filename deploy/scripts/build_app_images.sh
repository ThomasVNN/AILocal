#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/env/stack.env}"

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)"
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

platform_to_arch() {
  case "$1" in
    */arm64) printf 'arm64' ;;
    */amd64) printf 'amd64' ;;
    arm64|amd64) printf '%s' "$1" ;;
    *)
      echo "Unsupported Docker platform: $1" >&2
      return 1
      ;;
  esac
}

build_local_image() {
  local tag="$1"
  local platform="$2"
  local dockerfile="$3"
  local context="$4"
  shift 4

  local targetarch
  targetarch="$(platform_to_arch "$platform")"

  local requires_buildkit="0"
  local prefer_buildx="${DEPLOY_LOCAL_PREFER_BUILDX:-0}"
  local buildkit_progress="${BUILDKIT_PROGRESS:-plain}"

  if grep -q -- '--mount=' "$dockerfile"; then
    requires_buildkit="1"
  fi

  local buildx_cmd=(
    docker buildx build
    --platform "$platform"
    --progress "$buildkit_progress"
    --build-arg TARGETARCH="$targetarch"
    -t "$tag"
    -f "$dockerfile"
  )
  local daemon_cmd=(
    docker build
    --platform "$platform"
    --progress "$buildkit_progress"
    --build-arg TARGETARCH="$targetarch"
    -t "$tag"
    -f "$dockerfile"
  )

  if (($# > 0)); then
    buildx_cmd+=("$@")
    daemon_cmd+=("$@")
  fi

  buildx_cmd+=("$context" --load)
  daemon_cmd+=("$context")

  if [[ "$prefer_buildx" == "1" ]]; then
    if "${buildx_cmd[@]}"; then
      return 0
    fi
    echo "WARN: buildx failed for $tag; retrying with daemon BuildKit" >&2
    if DOCKER_BUILDKIT=1 "${daemon_cmd[@]}"; then
      return 0
    fi
  else
    if DOCKER_BUILDKIT=1 "${daemon_cmd[@]}"; then
      return 0
    fi
    echo "WARN: daemon BuildKit failed for $tag; retrying with buildx" >&2
    if "${buildx_cmd[@]}"; then
      return 0
    fi
  fi

  if [[ "$requires_buildkit" == "1" ]]; then
    echo "ERROR: both daemon BuildKit and buildx failed for $tag, and $dockerfile requires BuildKit features." >&2
    return 1
  fi

  echo "WARN: BuildKit paths failed for $tag; retrying with legacy builder" >&2
  local legacy_cmd=(
    docker build
    --build-arg TARGETARCH="$targetarch"
    -t "$tag"
    -f "$dockerfile"
  )

  if (($# > 0)); then
    legacy_cmd+=("$@")
  fi

  legacy_cmd+=("$context")
  DOCKER_BUILDKIT=0 "${legacy_cmd[@]}"
}

build_omniroute() {
  local image platform
  image="$(resolve_value OMNIROUTE_IMAGE 'omniroute:intel')"
  platform="$(resolve_value OMNIROUTE_PLATFORM 'linux/amd64')"

  build_local_image \
    "$image" \
    "$platform" \
    "$ROOT_DIR/OmniRoute/Dockerfile" \
    "$ROOT_DIR/OmniRoute" \
    --target "$(resolve_value OMNIROUTE_BUILD_TARGET 'runner-base')" \
    --build-arg BUILD_NODE_OPTIONS="$(resolve_value OMNIROUTE_BUILD_NODE_OPTIONS '--max-old-space-size=3072')" \
    --build-arg OMNIROUTE_NEXT_BUILD_CPUS="$(resolve_value OMNIROUTE_NEXT_BUILD_CPUS '2')" \
    --build-arg NPM_CONFIG_STRICT_SSL="$(resolve_value OMNIROUTE_BUILD_NPM_STRICT_SSL 'true')" \
    --build-arg NODE_TLS_REJECT_UNAUTHORIZED="$(resolve_value OMNIROUTE_BUILD_NODE_TLS_REJECT_UNAUTHORIZED '1')"
}

build_openwebui() {
  local image platform
  image="$(resolve_value OPENWEBUI_IMAGE 'open-webui:intel')"
  platform="$(resolve_value OPENWEBUI_PLATFORM 'linux/amd64')"

  build_local_image \
    "$image" \
    "$platform" \
    "$ROOT_DIR/open-webui/Dockerfile" \
    "$ROOT_DIR/open-webui" \
    --build-arg USE_OLLAMA="$(resolve_value OPENWEBUI_BUILD_USE_OLLAMA 'false')" \
    --build-arg USE_SLIM="$(resolve_value OPENWEBUI_BUILD_USE_SLIM 'true')" \
    --build-arg USE_PERMISSION_HARDENING="$(resolve_value OPENWEBUI_BUILD_USE_PERMISSION_HARDENING 'false')" \
    --build-arg BUILD_HASH="$(resolve_value OPENWEBUI_BUILD_HASH 'localagent-source')"
}

build_openclaw() {
  local image platform
  image="$(resolve_value OPENCLAW_IMAGE 'openclaw:intel')"
  platform="$(resolve_value OPENCLAW_PLATFORM 'linux/amd64')"

  build_local_image \
    "$image" \
    "$platform" \
    "$ROOT_DIR/openclaw/Dockerfile" \
    "$ROOT_DIR/openclaw" \
    --build-arg OPENCLAW_BUILD_NPM_STRICT_SSL="$(resolve_value OPENCLAW_BUILD_NPM_STRICT_SSL 'true')" \
    --build-arg OPENCLAW_BUILD_NODE_TLS_REJECT_UNAUTHORIZED="$(resolve_value OPENCLAW_BUILD_NODE_TLS_REJECT_UNAUTHORIZED '1')" \
    --build-arg OPENCLAW_BUILD_CURL_INSECURE="$(resolve_value OPENCLAW_BUILD_CURL_INSECURE '0')" \
    --build-arg OPENCLAW_NODE_BOOKWORM_IMAGE="$(resolve_value OPENCLAW_BUILD_NODE_BOOKWORM_IMAGE 'node:24-bookworm')" \
    --build-arg OPENCLAW_NODE_BOOKWORM_SLIM_IMAGE="$(resolve_value OPENCLAW_BUILD_NODE_BOOKWORM_SLIM_IMAGE 'node:24-bookworm-slim')" \
    --build-arg OPENCLAW_VARIANT="$(resolve_value OPENCLAW_BUILD_VARIANT 'default')" \
    --build-arg OPENCLAW_DOCKER_APT_UPGRADE="$(resolve_value OPENCLAW_BUILD_APT_UPGRADE '1')"
}

normalize_service_name() {
  case "$1" in
    omniroute) printf 'omniroute' ;;
    open-webui|openwebui) printf 'open-webui' ;;
    openclaw|openclaw-gateway|openclaw-cli) printf 'openclaw' ;;
    *)
      echo "Unknown app image target: $1" >&2
      return 1
      ;;
  esac
}

if (($# == 0)); then
  set -- omniroute open-webui openclaw
fi

declare -A requested=()
for service in "$@"; do
  requested["$(normalize_service_name "$service")"]=1
done

if [[ -n "${requested[omniroute]:-}" ]]; then
  echo "Building OmniRoute image from workspace source..."
  build_omniroute
fi

if [[ -n "${requested[open-webui]:-}" ]]; then
  echo "Building OpenWebUI image from workspace source..."
  build_openwebui
fi

if [[ -n "${requested[openclaw]:-}" ]]; then
  echo "Building OpenClaw image from workspace source..."
  build_openclaw
fi
