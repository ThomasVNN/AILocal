#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

DRY_RUN=0
targets=()
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    *)
      targets+=("$arg")
      ;;
  esac
done

if ((${#targets[@]} == 0)); then
  targets=(all)
fi

REGISTRY="${LOCALAGENT_IMAGE_REGISTRY:-mizuk1210.mulley-ray.ts.net:9999}"
REGISTRY="${REGISTRY%/}"
PLATFORM_NAMESPACE="${LOCALAGENT_PLATFORM_NAMESPACE:-localagent-platform}"
APPS_NAMESPACE="${LOCALAGENT_APPS_NAMESPACE:-localagent-apps}"
IMAGE_TAG="${LOCALAGENT_IMAGE_TAG:-dev}"
PLATFORMS="${LOCALAGENT_IMAGE_PLATFORMS:-linux/arm64,linux/amd64}"
PROGRESS="${BUILDKIT_PROGRESS:-plain}"
BUILDER="${LOCALAGENT_BUILDX_BUILDER:-localagent_multiarch}"
BUILDX_CONFIG="${LOCALAGENT_BUILDX_CONFIG:-$ROOT_DIR/deploy/buildkit/localagent.toml}"
PLATFORM_MIRROR_DOCKERFILE="${LOCALAGENT_PLATFORM_MIRROR_DOCKERFILE:-$ROOT_DIR/deploy/platform-images/Dockerfile.mirror}"
APP_BUILD_MODE="${LOCALAGENT_APP_BUILD_MODE:-sequential}"
PUBLISH_RETRIES="${LOCALAGENT_PUBLISH_RETRIES:-2}"

if [[ -n "${LOCALAGENT_GIT_TAG:-}" ]]; then
  GIT_TAG="$LOCALAGENT_GIT_TAG"
else
  short_sha="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  if [[ -n "$short_sha" ]]; then
    GIT_TAG="git-${short_sha}"
  else
    GIT_TAG="git-unknown"
  fi
fi

usage() {
  cat >&2 <<'EOF'
Usage:
  publish_multiarch_images.sh [--dry-run] [all|platform|apps|omniroute|open-webui|openclaw]

Env:
  LOCALAGENT_IMAGE_REGISTRY      Registry host, default mizuk1210.mulley-ray.ts.net:9999
  LOCALAGENT_PLATFORM_NAMESPACE  Platform image namespace, default localagent-platform
  LOCALAGENT_APPS_NAMESPACE      App image namespace, default localagent-apps
  LOCALAGENT_IMAGE_TAG           Mutable app image tag, default dev
  LOCALAGENT_GIT_TAG             Immutable app image tag, default git-<short-sha>
  LOCALAGENT_IMAGE_PLATFORMS     Build platforms, default linux/arm64,linux/amd64
  LOCALAGENT_BUILDX_BUILDER      Optional buildx builder name
  LOCALAGENT_APP_BUILD_MODE      sequential (default) or multiarch
  LOCALAGENT_PUBLISH_RETRIES     Attempts per docker publish command, default 2
EOF
}

run_cmd() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '%s\n' "$*"
    return 0
  fi

  local attempt=1
  while true; do
    if "$@"; then
      return 0
    fi
    if ((attempt >= PUBLISH_RETRIES)); then
      return 1
    fi
    echo "WARN: command failed; retrying ($((attempt + 1))/$PUBLISH_RETRIES): $*" >&2
    sleep "$((attempt * 5))"
    attempt=$((attempt + 1))
  done
}

ensure_builder() {
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi

  if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    docker buildx inspect "$BUILDER" --bootstrap >/dev/null
    return 0
  fi

  if [[ ! -f "$BUILDX_CONFIG" ]]; then
    echo "Missing BuildKit config: $BUILDX_CONFIG" >&2
    return 1
  fi

  docker buildx create \
    --name "$BUILDER" \
    --driver docker-container \
    --driver-opt memory="${LOCALAGENT_BUILDX_MEMORY:-7g}" \
    --config "$BUILDX_CONFIG" \
    --use >/dev/null
  docker buildx inspect "$BUILDER" --bootstrap >/dev/null
}

has_target() {
  local expected="$1"
  local target
  for target in "${targets[@]}"; do
    case "$target" in
      all)
        return 0
        ;;
      apps)
        case "$expected" in
          omniroute|open-webui|openclaw) return 0 ;;
        esac
        ;;
      platform)
        [[ "$expected" == platform ]] && return 0
        ;;
      omniroute|open-webui|openclaw)
        [[ "$expected" == "$target" ]] && return 0
        ;;
      -h|--help|help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown image target: $target" >&2
        usage
        exit 2
        ;;
    esac
  done
  return 1
}

platform_ref() {
  local name="$1"
  local tag="$2"
  printf '%s/%s/%s:%s' "$REGISTRY" "$PLATFORM_NAMESPACE" "$name" "$tag"
}

app_ref() {
  local name="$1"
  local tag="$2"
  printf '%s/%s/%s:%s' "$REGISTRY" "$APPS_NAMESPACE" "$name" "$tag"
}

platform_tag_suffix() {
  local platform="$1"
  platform="${platform//\//-}"
  platform="${platform//:/-}"
  printf '%s' "$platform"
}

mirror_platform_image() {
  local source="$1"
  local name="$2"
  local tag="$3"
  local dest
  dest="$(platform_ref "$name" "$tag")"

  echo "Publishing platform image $source -> $dest"
  run_cmd docker buildx build \
    --builder "$BUILDER" \
    --platform "$PLATFORMS" \
    --progress "$PROGRESS" \
    -t "$dest" \
    -f "$PLATFORM_MIRROR_DOCKERFILE" \
    --build-arg "BASE_IMAGE=$source" \
    --push \
    "$ROOT_DIR/deploy/platform-images"
}

publish_platform_images() {
  mirror_platform_image "postgres:16-alpine" "postgres" "16-alpine"
  mirror_platform_image "prodrigestivill/postgres-backup-local:16" "postgres-backup-local" "16"
  mirror_platform_image "redis:7-alpine" "redis" "7-alpine"
  mirror_platform_image "minio/minio:RELEASE.2025-09-07T16-13-09Z" "minio" "RELEASE.2025-09-07T16-13-09Z"
  mirror_platform_image "minio/mc:RELEASE.2025-08-13T08-35-41Z" "mc" "RELEASE.2025-08-13T08-35-41Z"
  mirror_platform_image "traefik:v3.1" "traefik" "v3.1"
}

publish_app_image() {
  local name="$1"
  local dockerfile="$2"
  local context="$3"
  shift 3

  local primary git_tag_ref
  primary="$(app_ref "$name" "$IMAGE_TAG")"
  git_tag_ref="$(app_ref "$name" "$GIT_TAG")"

  echo "Publishing app image $name -> $primary and $git_tag_ref"

  if [[ "$APP_BUILD_MODE" == "multiarch" ]]; then
    run_cmd docker buildx build \
      --builder "$BUILDER" \
      --platform "$PLATFORMS" \
      --progress "$PROGRESS" \
      -t "$primary" \
      -t "$git_tag_ref" \
      -f "$dockerfile" \
      "$@" \
      --push \
      "$context"
    return 0
  fi

  if [[ "$APP_BUILD_MODE" != "sequential" ]]; then
    echo "Unsupported LOCALAGENT_APP_BUILD_MODE=$APP_BUILD_MODE (expected sequential or multiarch)" >&2
    return 2
  fi

  local platforms=()
  local saved_ifs="$IFS"
  IFS=,
  read -r -a platforms <<<"$PLATFORMS"
  IFS="$saved_ifs"

  local platform suffix primary_platform git_platform
  local primary_platform_refs=()
  local git_platform_refs=()
  for platform in "${platforms[@]}"; do
    suffix="$(platform_tag_suffix "$platform")"
    primary_platform="$(app_ref "$name" "${IMAGE_TAG}-${suffix}")"
    git_platform="$(app_ref "$name" "${GIT_TAG}-${suffix}")"
    primary_platform_refs+=("$primary_platform")
    git_platform_refs+=("$git_platform")

    echo "Publishing app image $name for $platform -> $primary_platform and $git_platform"
    run_cmd docker buildx build \
      --builder "$BUILDER" \
      --platform "$platform" \
      --progress "$PROGRESS" \
      -t "$primary_platform" \
      -t "$git_platform" \
      -f "$dockerfile" \
      "$@" \
      --push \
      "$context"
  done

  echo "Publishing app manifest $primary"
  run_cmd docker buildx imagetools create \
    --builder "$BUILDER" \
    --progress "$PROGRESS" \
    -t "$primary" \
    "${primary_platform_refs[@]}"

  echo "Publishing app manifest $git_tag_ref"
  run_cmd docker buildx imagetools create \
    --builder "$BUILDER" \
    --progress "$PROGRESS" \
    -t "$git_tag_ref" \
    "${git_platform_refs[@]}"
}

publish_omniroute() {
  publish_app_image \
    "omniroute" \
    "$ROOT_DIR/OmniRoute/Dockerfile" \
    "$ROOT_DIR/OmniRoute" \
    --target "${OMNIROUTE_BUILD_TARGET:-runner-base}" \
    --build-arg "BUILD_NODE_OPTIONS=${OMNIROUTE_BUILD_NODE_OPTIONS:---max-old-space-size=2048}" \
    --build-arg "OMNIROUTE_NEXT_BUILD_CPUS=${OMNIROUTE_NEXT_BUILD_CPUS:-1}" \
    --build-arg "NPM_CONFIG_STRICT_SSL=${OMNIROUTE_BUILD_NPM_STRICT_SSL:-true}" \
    --build-arg "NODE_TLS_REJECT_UNAUTHORIZED=${OMNIROUTE_BUILD_NODE_TLS_REJECT_UNAUTHORIZED:-1}"
}

publish_openwebui() {
  publish_app_image \
    "open-webui" \
    "$ROOT_DIR/open-webui/Dockerfile" \
    "$ROOT_DIR/open-webui" \
    --build-arg "BUILD_NODE_OPTIONS=${OPENWEBUI_BUILD_NODE_OPTIONS:---max-old-space-size=4096}" \
    --build-arg "USE_OLLAMA=${OPENWEBUI_BUILD_USE_OLLAMA:-false}" \
    --build-arg "USE_SLIM=${OPENWEBUI_BUILD_USE_SLIM:-true}" \
    --build-arg "USE_PERMISSION_HARDENING=${OPENWEBUI_BUILD_USE_PERMISSION_HARDENING:-false}" \
    --build-arg "BUILD_HASH=${OPENWEBUI_BUILD_HASH:-localagent-source}"
}

publish_openclaw() {
  publish_app_image \
    "openclaw" \
    "$ROOT_DIR/openclaw/Dockerfile" \
    "$ROOT_DIR/openclaw" \
    --build-arg "OPENCLAW_BUILD_NPM_STRICT_SSL=${OPENCLAW_BUILD_NPM_STRICT_SSL:-true}" \
    --build-arg "OPENCLAW_BUILD_NODE_TLS_REJECT_UNAUTHORIZED=${OPENCLAW_BUILD_NODE_TLS_REJECT_UNAUTHORIZED:-1}" \
    --build-arg "OPENCLAW_BUILD_CURL_INSECURE=${OPENCLAW_BUILD_CURL_INSECURE:-0}" \
    --build-arg "OPENCLAW_NODE_BOOKWORM_IMAGE=${OPENCLAW_BUILD_NODE_BOOKWORM_IMAGE:-node:24-bookworm}" \
    --build-arg "OPENCLAW_NODE_BOOKWORM_SLIM_IMAGE=${OPENCLAW_BUILD_NODE_BOOKWORM_SLIM_IMAGE:-node:24-bookworm-slim}" \
    --build-arg "OPENCLAW_VARIANT=${OPENCLAW_BUILD_VARIANT:-slim}" \
    --build-arg "OPENCLAW_DOCKER_APT_UPGRADE=${OPENCLAW_BUILD_APT_UPGRADE:-0}"
}

ensure_builder

if has_target platform; then
  publish_platform_images
fi

if has_target omniroute; then
  publish_omniroute
fi

if has_target open-webui; then
  publish_openwebui
fi

if has_target openclaw; then
  publish_openclaw
fi
