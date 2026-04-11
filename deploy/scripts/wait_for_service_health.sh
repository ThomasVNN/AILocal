#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"

if [[ $# -lt 2 || $# -gt 3 ]]; then
  cat >&2 <<'EOF'
Usage:
  wait_for_service_health.sh <platform|apps> <service> [timeout-seconds]
EOF
  exit 2
fi

target="$1"
service="$2"
timeout_seconds="${3:-300}"

case "$target" in
  platform)
    compose_file="$DEPLOY_DIR/layer1-platform/docker-compose.yml"
    ;;
  apps)
    compose_file="$DEPLOY_DIR/layer2-apps/docker-compose.yml"
    ;;
  *)
    echo "Unsupported compose target: $target" >&2
    exit 2
    ;;
esac

container_id="$(docker compose --env-file "$ENV_FILE" -f "$compose_file" ps -q "$service" | tail -n 1)"
if [[ -z "$container_id" ]]; then
  echo "Service $service is not running in $target compose." >&2
  exit 1
fi

deadline=$((SECONDS + timeout_seconds))
while ((SECONDS < deadline)); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  case "$status" in
    healthy|running)
      exit 0
      ;;
    unhealthy|exited|dead)
      echo "Service $service entered terminal state: $status" >&2
      exit 1
      ;;
  esac
  sleep 2
done

echo "Timed out waiting for $service in $target compose after ${timeout_seconds}s." >&2
exit 1
