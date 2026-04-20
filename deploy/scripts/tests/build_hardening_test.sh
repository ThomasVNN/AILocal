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

test_build_app_images_treats_buildplatform_dockerfiles_as_buildkit_only() {
  local script
  script="$(<"$ROOT_DIR/deploy/scripts/build_app_images.sh")"

  assert_contains \
    "dockerfile_requires_buildkit" \
    "$script" \
    "build_app_images should centralize BuildKit-only Dockerfile detection"

  assert_contains \
    "dockerfile_requires_buildkit \"\$dockerfile\"" \
    "$script" \
    "build_app_images should treat BUILDPLATFORM-based Dockerfiles as BuildKit-only before considering legacy builder"
}

test_openwebui_frontend_install_retries_transient_npm_failures() {
  local dockerfile
  dockerfile="$(<"$ROOT_DIR/open-webui/Dockerfile")"

  assert_contains \
    "for attempt in 1 2 3 4 5; do" \
    "$dockerfile" \
    "open-webui frontend install should retry transient npm failures"

  assert_contains \
    "npm ci --force --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000" \
    "$dockerfile" \
    "open-webui frontend install should use npm fetch retry settings during image build"
}

main() {
  test_build_app_images_treats_buildplatform_dockerfiles_as_buildkit_only
  test_openwebui_frontend_install_retries_transient_npm_failures
  echo "build_hardening_test: ok"
}

main "$@"
