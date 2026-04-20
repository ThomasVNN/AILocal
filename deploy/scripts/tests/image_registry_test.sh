#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"

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

assert_contains() {
  local needle="$1"
  local haystack="$2"
  local message="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "ASSERT_CONTAINS failed: $message" >&2
    echo "  expected substring: $needle" >&2
    echo "  actual: $haystack" >&2
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  local file="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

create_minimal_env() {
  local file="$1"
  printf '%s\n' \
    "TZ=Asia/Ho_Chi_Minh" \
    "POSTGRES_PASSWORD=test-postgres" \
    "REDIS_PASSWORD=test-redis" \
    "MINIO_ROOT_PASSWORD=test-minio" \
    "JWT_SECRET=test-jwt" \
    "API_KEY_SECRET=test-api-key" \
    "INITIAL_PASSWORD=test-password" \
    "STORAGE_ENCRYPTION_KEY=test-storage" \
    "OPENCLAW_GATEWAY_TOKEN=test-openclaw" > "$file"
}

test_registry_reconcile_sets_platform_and_app_images() {
  local tmp_dir env_file
  tmp_dir="$(mktemp -d)"
  env_file="$tmp_dir/stack.env"
  create_minimal_env "$env_file"

  LOCALAGENT_USE_REGISTRY_IMAGES=true \
    LOCALAGENT_IMAGE_REGISTRY=registry.test:9999 \
    LOCALAGENT_PLATFORM_NAMESPACE=localagent-platform \
    LOCALAGENT_APPS_NAMESPACE=localagent-apps \
    LOCALAGENT_IMAGE_TAG=dev \
    bash "$ROOT_DIR/deploy/scripts/reconcile_app_image_env.sh" server "$env_file"

  assert_eq "registry.test:9999/localagent-platform/postgres:16-alpine" "$(read_env_value POSTGRES_IMAGE "$env_file")" "Postgres image should use platform registry namespace"
  assert_eq "registry.test:9999/localagent-platform/redis:7-alpine" "$(read_env_value REDIS_IMAGE "$env_file")" "Redis image should use platform registry namespace"
  assert_eq "registry.test:9999/localagent-platform/traefik:v3.1" "$(read_env_value TRAEFIK_IMAGE "$env_file")" "Traefik image should use platform registry namespace"
  assert_eq "registry.test:9999/localagent-apps/omniroute:dev" "$(read_env_value OMNIROUTE_IMAGE "$env_file")" "OmniRoute should use app registry namespace"
  assert_eq "registry.test:9999/localagent-apps/open-webui:dev" "$(read_env_value OPENWEBUI_IMAGE "$env_file")" "OpenWebUI should use app registry namespace"
  assert_eq "registry.test:9999/localagent-apps/openclaw:dev" "$(read_env_value OPENCLAW_IMAGE "$env_file")" "OpenClaw should use app registry namespace"
  assert_eq "linux/amd64" "$(read_env_value OMNIROUTE_PLATFORM "$env_file")" "Server mode should keep amd64 platform"
  assert_eq "missing" "$(read_env_value APP_PULL_POLICY "$env_file")" "Registry mode should allow compose to pull app images"

  rm -rf "$tmp_dir"
}

test_source_reconcile_keeps_public_platform_and_local_app_images() {
  local tmp_dir env_file
  tmp_dir="$(mktemp -d)"
  env_file="$tmp_dir/stack.env"
  create_minimal_env "$env_file"

  LOCALAGENT_USE_REGISTRY_IMAGES=false \
    bash "$ROOT_DIR/deploy/scripts/reconcile_app_image_env.sh" local "$env_file"

  assert_eq "postgres:16-alpine" "$(read_env_value POSTGRES_IMAGE "$env_file")" "Source mode should keep public Postgres default"
  assert_eq "redis:7-alpine" "$(read_env_value REDIS_IMAGE "$env_file")" "Source mode should keep public Redis default"
  assert_eq "traefik:v3.1" "$(read_env_value TRAEFIK_IMAGE "$env_file")" "Source mode should keep public Traefik default"
  assert_eq "omniroute:local" "$(read_env_value OMNIROUTE_IMAGE "$env_file")" "Local mode should keep local OmniRoute image"
  assert_eq "open-webui:local" "$(read_env_value OPENWEBUI_IMAGE "$env_file")" "Local mode should keep local OpenWebUI image"
  assert_eq "openclaw:local" "$(read_env_value OPENCLAW_IMAGE "$env_file")" "Local mode should keep local OpenClaw image"
  assert_eq "linux/arm64" "$(read_env_value OPENCLAW_PLATFORM "$env_file")" "Local mode should keep arm64 platform"
  assert_eq "never" "$(read_env_value APP_PULL_POLICY "$env_file")" "Source mode should not pull app images"

  rm -rf "$tmp_dir"
}

test_publish_multiarch_dry_run_lists_platform_and_app_commands() {
  local output
  output="$(
    LOCALAGENT_IMAGE_REGISTRY=registry.test:9999 \
    LOCALAGENT_IMAGE_TAG=dev \
    LOCALAGENT_GIT_TAG=git-test \
    bash "$ROOT_DIR/deploy/scripts/publish_multiarch_images.sh" --dry-run all
  )"

  assert_contains "docker buildx build --builder localagent_multiarch --platform linux/arm64,linux/amd64 --progress plain -t registry.test:9999/localagent-platform/postgres:16-alpine -f $ROOT_DIR/deploy/platform-images/Dockerfile.mirror --build-arg BASE_IMAGE=postgres:16-alpine --push $ROOT_DIR/deploy/platform-images" "$output" "Platform mirror should include Postgres"
  assert_contains "docker buildx build --builder localagent_multiarch --platform linux/arm64" "$output" "App publish should build arm64 sequentially"
  assert_contains "docker buildx build --builder localagent_multiarch --platform linux/amd64" "$output" "App publish should build amd64 sequentially"
  assert_contains "-t registry.test:9999/localagent-apps/omniroute:dev-linux-arm64" "$output" "OmniRoute arm64 tag should be emitted"
  assert_contains "-t registry.test:9999/localagent-apps/open-webui:git-test-linux-amd64" "$output" "OpenWebUI amd64 git tag should be emitted"
  assert_contains "docker buildx imagetools create --builder localagent_multiarch --progress plain -t registry.test:9999/localagent-apps/omniroute:dev registry.test:9999/localagent-apps/omniroute:dev-linux-arm64 registry.test:9999/localagent-apps/omniroute:dev-linux-amd64" "$output" "OmniRoute dev manifest should merge per-platform tags"
  assert_contains "--build-arg OPENCLAW_VARIANT=slim" "$output" "OpenClaw should default to slim runtime variant"
}

main() {
  test_registry_reconcile_sets_platform_and_app_images
  test_source_reconcile_keeps_public_platform_and_local_app_images
  test_publish_multiarch_dry_run_lists_platform_and_app_commands
  echo "image_registry_test: ok"
}

main "$@"
