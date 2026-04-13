#!/usr/bin/env bash
# Fast deploy: build locally, stream Docker image via SSH pipe (no temp file needed)
# Data volumes are never touched.
set -euo pipefail

SERVICE="${1:-omniroute}"

if [ "$SERVICE" != "omniroute" ]; then
  echo "Currently only omniroute deploy is supported by this script."
  exit 1
fi

SSH_KEY="${HOME}/.ssh/server-mzk-12-10"
SSH_USER="mzk-12-10"
SSH_HOST="192.168.1.65"
SSH="ssh -o StrictHostKeyChecking=no -o BatchMode=yes -i ${SSH_KEY} ${SSH_USER}@${SSH_HOST}"
IMAGE="omniroute:intel"
CONTAINER="omniroute"
ENV_FILE="/home/mzk-12-10/omniroute/.env"
DATA_MOUNT="/data/ai/openclaw/data/omniroute-data:/app/data:rw"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=== OmniRoute Local Build & Deploy via SSH Stream ==="
echo ""

echo "[1/5] Building Docker image locally (linux/amd64)..."
docker build --platform linux/amd64 -t ${IMAGE} --target runner-cli .

echo "[2/5] Tagging backup on server..."
$SSH "docker tag ${IMAGE} omniroute:intel_prev_${TIMESTAMP} 2>/dev/null || echo '(no prev image to backup)'"

echo "[3/5] Streaming image to server via SSH pipe..."
echo "      (This avoids saving to disk — transfers directly)"
docker save "${IMAGE}" | $SSH "docker load"
echo "      Image loaded on server."

echo "[4/5] Swapping container (data preserved)..."
$SSH "docker stop --time 15 ${CONTAINER} 2>/dev/null || true"
$SSH "docker rm ${CONTAINER} 2>/dev/null || true"
$SSH "mkdir -p /data/ai/openclaw/data/omniroute-data"
$SSH "docker run -d \
  --name ${CONTAINER} \
  --restart unless-stopped \
  --network openclaw_default \
  -v ${DATA_MOUNT} \
  -p 20128:20128 \
  -p 20129:20129 \
  --env-file ${ENV_FILE} \
  --dns 8.8.8.8 --dns 1.1.1.1 \
  ${IMAGE}"

echo "[5/5] Verifying..."
sleep 6
STATUS=$($SSH "docker inspect --format '{{.State.Status}}' ${CONTAINER} 2>/dev/null || echo error")

if [[ "$STATUS" == "running" ]]; then
  echo ""
  echo "✅ OmniRoute deployed successfully!"
  echo "   URL:      http://${SSH_HOST}:20128"
  echo "   Data:     /data/ai/openclaw/data/omniroute-data (untouched ✓)"
  echo "   Rollback: ssh ${SSH_USER}@${SSH_HOST} docker tag omniroute:intel_prev_${TIMESTAMP} omniroute:intel && docker restart omniroute"
  echo ""
  echo "=== Startup logs ==="
  $SSH "docker logs --tail 20 ${CONTAINER} 2>&1"
else
  echo "❌ Deploy failed! Container status: ${STATUS}"
  echo ""
  echo "=== Error logs ==="
  $SSH "docker logs --tail 30 ${CONTAINER} 2>&1" || true
  exit 1
fi
