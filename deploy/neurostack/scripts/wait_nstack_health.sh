#!/usr/bin/env bash
# NeuroStack wait_for_service_health wrapper
# Waits for a service in neurostack-platform or neurostack-apps to become healthy
# Usage: NS_COMPOSE_DIR=... ENV_FILE=... bash wait_nstack_health.sh <platform|apps> <service> [timeout]
set -euo pipefail

NEUROSTACK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$NEUROSTACK_DIR/../env/nstack.local.env}"

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 <platform|apps> <service> [timeout-seconds]" >&2
  exit 2
fi

target="$1"
service="$2"
timeout_seconds="${3:-300}"

case "$target" in
  platform|neurostack-platform)
    compose_file="$NEUROSTACK_DIR/layer1-platform/docker-compose.yml"
    ;;
  apps|neurostack-apps)
    compose_file="$NEUROSTACK_DIR/layer2-apps/docker-compose.yml"
    ;;
  *)
    echo "Unsupported target: $target (use platform or apps)" >&2
    exit 2
    ;;
esac

container_id="$(docker compose --env-file "$ENV_FILE" -f "$compose_file" ps -q "$service" | tail -n 1)"
if [[ -z "$container_id" ]]; then
  echo "Service $service not running in neurostack-$target compose." >&2
  exit 1
fi

deadline=$((SECONDS + timeout_seconds))
echo "Waiting for $service to be healthy (timeout: ${timeout_seconds}s)..."
while ((SECONDS < deadline)); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  case "$status" in
    healthy|running)
      echo "  $service: $status ✓"
      exit 0
      ;;
    unhealthy|exited|dead)
      echo "Service $service entered terminal state: $status" >&2
      exit 1
      ;;
  esac
  sleep 3
done

echo "Timed out waiting for $service after ${timeout_seconds}s." >&2
exit 1
