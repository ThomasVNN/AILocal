#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

REMOTE="${1:-}"
REMOTE_DIR="${2:-/opt/localagent}"

if [[ -z "$REMOTE" ]]; then
  echo "Usage: $0 <user@host> [remote_dir]" >&2
  echo "Example: $0 mzk-12-10@100.101.77.8 /opt/localagent" >&2
  exit 2
fi

echo "Syncing $DEPLOY_DIR -> $REMOTE:$REMOTE_DIR/deploy"
echo "NOTE: env/stack.env is excluded (manage secrets on the server)."

rsync -av \
  --exclude 'env/stack.env' \
  --exclude '.DS_Store' \
  "$DEPLOY_DIR/" \
  "$REMOTE:$REMOTE_DIR/deploy/"

echo "Done."
echo "Next on server:"
echo "  cd \"$REMOTE_DIR\""
echo "  sudo -E bash deploy/scripts/bootstrap_data_dirs.sh"
echo "  bash deploy/scripts/ensure_https_env.sh deploy/env/stack.env"
echo "  bash deploy/scripts/stack.sh platform up -d"
echo "  bash deploy/scripts/bootstrap_openclaw.sh"
echo "  bash deploy/scripts/stack.sh apps up -d"
