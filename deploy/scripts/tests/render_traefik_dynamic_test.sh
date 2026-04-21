#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

env_file="$tmp_dir/stack.env"
cat >"$env_file" <<EOF
LA_DATA_ROOT=$tmp_dir/data
TRAEFIK_DASHBOARD_HOST=traefik.localagent.local
OMNIROUTE_HOST=router.localagent.local
OMNIROUTE_API_HOST=api.localagent.local
OPENWEBUI_HOST=chat.localagent.local
OPENCLAW_HOST=openclaw.localagent.local
MINIO_API_HOST=s3.localagent.local
MINIO_CONSOLE_HOST=minio.localagent.local
TRAEFIK_TLS_ENABLED=true
TRAEFIK_HTTPS_PORT=8443
TRAEFIK_HSTS_SECONDS=0
EOF

ENV_FILE="$env_file" bash "$REPO_ROOT/deploy/scripts/render_traefik_dynamic.sh" >/dev/null
dynamic_file="$tmp_dir/data/platform/proxy/traefik/dynamic.yml"

assert_contains() {
  local needle="$1"
  local message="$2"
  if ! grep -Fq "$needle" "$dynamic_file"; then
    echo "ASSERT_CONTAINS failed: $message" >&2
    echo "  missing: $needle" >&2
    exit 1
  fi
}

assert_contains "omniroute-direct-api:" "router host should expose a direct API router"
assert_contains "Host(\`router.localagent.local\`) && (PathPrefix(\`/v1\`) || PathPrefix(\`/models\`) || PathPrefix(\`/chat/completions\`) || PathPrefix(\`/responses\`) || PathPrefix(\`/codex\`))" "direct API route should match OpenAI-compatible paths on router host"
assert_contains "priority: 200" "direct API route should outrank the dashboard router"
assert_contains "service: omniroute-api" "direct API route should use the API bridge service"

env_file_no_tls="$tmp_dir/stack.no-tls.env"
cat >"$env_file_no_tls" <<EOF
LA_DATA_ROOT=$tmp_dir/no-tls-data
TRAEFIK_DASHBOARD_HOST=traefik.localagent.local
OMNIROUTE_HOST=router.localagent.local
OMNIROUTE_API_HOST=api.localagent.local
OPENWEBUI_HOST=chat.localagent.local
OPENCLAW_HOST=openclaw.localagent.local
MINIO_API_HOST=s3.localagent.local
MINIO_CONSOLE_HOST=minio.localagent.local
TRAEFIK_TLS_ENABLED=false
TRAEFIK_HTTPS_PORT=8443
TRAEFIK_HSTS_SECONDS=0
EOF

ENV_FILE="$env_file_no_tls" bash "$REPO_ROOT/deploy/scripts/render_traefik_dynamic.sh" >/dev/null
dynamic_file="$tmp_dir/no-tls-data/platform/proxy/traefik/dynamic.yml"

assert_contains "openwebui:" "non-TLS render should include normal app routers"
if grep -Fq "None" "$dynamic_file"; then
  echo "ASSERT_CONTAINS failed: non-TLS render should not include Python None output" >&2
  exit 1
fi

echo "render_traefik_dynamic_test: ok"
