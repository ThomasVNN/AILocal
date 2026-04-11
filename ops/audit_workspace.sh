#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

section() {
  printf '\n[%s]\n' "$1"
}

show_path() {
  local path="$1"
  if [[ -e "$ROOT_DIR/$path" ]]; then
    printf 'OK  %s\n' "$path"
  else
    printf 'MISS %s\n' "$path"
  fi
}

section "Root"
printf '%s\n' "$ROOT_DIR"

section "Active Paths"
show_path "deploy"
show_path "ops"
show_path "docs"
show_path ".localagent-data"
show_path "OmniRoute"
show_path "openclaw"
show_path "open-webui"
show_path "claude-code"

section "Non-Deploy Paths"
show_path "legacy/unified-stack"
show_path "legacy/quarantine"
show_path "artifacts/images"
show_path "artifacts/backups"
show_path "OmniRoute-merge"

section "Top-level Sizes"
(
  cd "$ROOT_DIR"
  du -sh .localagent-data legacy artifacts OmniRoute OmniRoute-merge openclaw open-webui claude-code 2>/dev/null | sort -h
)

if command -v docker >/dev/null 2>&1; then
  section "LocalAgent Containers"
  docker ps --format '{{.Names}}|{{.Status}}' | awk -F'|' '/^localagent-/ {printf "%-40s %s\n", $1, $2}'

  section "Active Mounts"
  docker ps -q --filter name=localagent- | xargs -r docker inspect --format '{{.Name}}|{{range .Mounts}}{{.Source}} -> {{.Destination}};{{end}}'
fi
