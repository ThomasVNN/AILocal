#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${1:-${LA_DATA_ROOT:-/data/localagent}}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_ROOT/platform/backups/snapshots}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/localagent-snapshot-$TS.tar.gz"

mkdir -p "$BACKUP_DIR"

tar -C "$DATA_ROOT" -czf "$OUT" \
  apps/omniroute/data \
  apps/openclaw/config \
  apps/openclaw/workspace \
  apps/open-webui/runtime \
  platform/minio/data

echo "$OUT"

