#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

SERVER_REMOTE="${SERVER_REMOTE:-mzk-12-10@100.101.77.8}"
SERVER_DIR="${SERVER_DIR:-~/localagent}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$SERVER_DIR/deploy/env/stack.env}"
SERVER_SSH_KEY="${SERVER_SSH_KEY:-}"
SERVER_SSH_PASS="${SERVER_SSH_PASS:-}"
SERVER_STRICT_HOST_KEY_CHECKING="${SERVER_STRICT_HOST_KEY_CHECKING:-accept-new}"
SERVER_DEPLOY_IMAGE_TRANSPORT="${SERVER_DEPLOY_IMAGE_TRANSPORT:-registry}"
LOCALAGENT_IMAGE_REGISTRY="${LOCALAGENT_IMAGE_REGISTRY:-mizuk1210.mulley-ray.ts.net:9999}"
SERVER_DEPLOY_IMAGE_TAG="${SERVER_DEPLOY_IMAGE_TAG:-dev-server}"
SERVER_DEPLOY_IMAGE_PLATFORMS="${SERVER_DEPLOY_IMAGE_PLATFORMS:-linux/amd64}"
LOCALAGENT_IMAGE_TAG="${LOCALAGENT_IMAGE_TAG:-$SERVER_DEPLOY_IMAGE_TAG}"
LOCALAGENT_PLATFORM_NAMESPACE="${LOCALAGENT_PLATFORM_NAMESPACE:-localagent-platform}"
LOCALAGENT_APPS_NAMESPACE="${LOCALAGENT_APPS_NAMESPACE:-localagent-apps}"
SERVER_TRAEFIK_HTTP_PORT="${SERVER_TRAEFIK_HTTP_PORT:-}"
SERVER_TRAEFIK_HTTPS_PORT="${SERVER_TRAEFIK_HTTPS_PORT:-}"

SSH_OPTS=(-o "StrictHostKeyChecking=${SERVER_STRICT_HOST_KEY_CHECKING}")
if [[ -n "$SERVER_SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SERVER_SSH_KEY")
fi

if [[ -n "$SERVER_SSH_PASS" ]]; then
  SSH_BASE=(sshpass -p "$SERVER_SSH_PASS" ssh "${SSH_OPTS[@]}")
  SCP_BASE=(sshpass -p "$SERVER_SSH_PASS" scp "${SSH_OPTS[@]}")
else
  SSH_BASE=(ssh "${SSH_OPTS[@]}")
  SCP_BASE=(scp "${SSH_OPTS[@]}")
fi

upload_file() {
  local local_file="$1"
  local remote_file="$2"
  "${SSH_BASE[@]}" "$SERVER_REMOTE" "cat > $remote_file" <"$local_file"
}

echo "[1/6] Review workspace state"
git -C "$ROOT_DIR/OmniRoute" log -1 --oneline || true
if ! git -C "$ROOT_DIR/OmniRoute" diff --no-ext-diff --quiet HEAD --; then
  echo "WARN: OmniRoute workspace has tracked changes." >&2
fi

tmp_images="$(mktemp -t localagent-app-images.XXXXXX.tar.gz)"
tmp_deploy="$(mktemp -t localagent-deploy.XXXXXX.tar.gz)"
trap 'rm -f "$tmp_images" "$tmp_deploy"' EXIT

case "$SERVER_DEPLOY_IMAGE_TRANSPORT" in
  registry)
    echo "[2/6] Publish server images to $LOCALAGENT_IMAGE_REGISTRY ($LOCALAGENT_IMAGE_TAG, ${LOCALAGENT_IMAGE_PLATFORMS:-$SERVER_DEPLOY_IMAGE_PLATFORMS})"
    LOCALAGENT_IMAGE_REGISTRY="$LOCALAGENT_IMAGE_REGISTRY" \
    LOCALAGENT_PLATFORM_NAMESPACE="$LOCALAGENT_PLATFORM_NAMESPACE" \
    LOCALAGENT_APPS_NAMESPACE="$LOCALAGENT_APPS_NAMESPACE" \
    LOCALAGENT_IMAGE_TAG="$LOCALAGENT_IMAGE_TAG" \
    LOCALAGENT_IMAGE_PLATFORMS="${LOCALAGENT_IMAGE_PLATFORMS:-$SERVER_DEPLOY_IMAGE_PLATFORMS}" \
      bash "$ROOT_DIR/deploy/scripts/publish_multiarch_images.sh" all
    ;;
  tar)
    echo "[2/6] Build amd64 app images from workspace source"
    OMNIROUTE_IMAGE="omniroute:intel" \
    OMNIROUTE_PLATFORM="linux/amd64" \
    OPENWEBUI_IMAGE="open-webui:intel" \
    OPENWEBUI_PLATFORM="linux/amd64" \
    OPENCLAW_IMAGE="openclaw:intel" \
    OPENCLAW_PLATFORM="linux/amd64" \
    ENV_FILE="$ROOT_DIR/deploy/env/stack.server.env.example" \
      bash "$ROOT_DIR/deploy/scripts/build_app_images.sh" omniroute open-webui openclaw

    docker save omniroute:intel open-webui:intel openclaw:intel | gzip -c >"$tmp_images"
    ;;
  remote-build)
    echo "[2/6] Package source for remote amd64 app image build"
    ;;
  *)
    echo "Unsupported SERVER_DEPLOY_IMAGE_TRANSPORT=$SERVER_DEPLOY_IMAGE_TRANSPORT (expected registry, tar, or remote-build)" >&2
    exit 2
    ;;
esac

deploy_bundle_entries=(deploy)
if [[ "$SERVER_DEPLOY_IMAGE_TRANSPORT" == "remote-build" ]]; then
  deploy_bundle_entries+=(OmniRoute open-webui openclaw)
fi

COPYFILE_DISABLE=1 tar --no-xattrs -C "$ROOT_DIR" \
  --exclude='deploy/env/stack.env' \
  --exclude='deploy/env/stack.local.env' \
  --exclude='._*' \
  --exclude='*/._*' \
  --exclude='.DS_Store' \
  --exclude='.git' \
  --exclude='OmniRoute/node_modules' \
  --exclude='OmniRoute/.next' \
  --exclude='OmniRoute/build' \
  --exclude='OmniRoute/dist' \
  --exclude='open-webui/node_modules' \
  --exclude='open-webui/.svelte-kit' \
  --exclude='open-webui/build' \
  --exclude='open-webui/data' \
  --exclude='openclaw/node_modules' \
  --exclude='openclaw/.agent' \
  --exclude='openclaw/.agents' \
  --exclude='openclaw/dist' \
  --exclude='openclaw/ui/dist' \
  -czf "$tmp_deploy" \
  "${deploy_bundle_entries[@]}"

remote_tmp="${SERVER_REMOTE_TMP:-.localagent_tmp}"

echo "[3/6] Upload deploy bundle"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "mkdir -p $SERVER_DIR $remote_tmp"
upload_file "$tmp_deploy" "$remote_tmp/deploy_bundle.tar.gz"
if [[ "$SERVER_DEPLOY_IMAGE_TRANSPORT" == "tar" ]]; then
  echo "Uploading source-built app image tar"
  upload_file "$tmp_images" "$remote_tmp/app_images.tar.gz"
fi

echo "[4/6] Reconcile remote env and rollout platform/app stack"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "set -euo pipefail; \
  mkdir -p $SERVER_DIR; \
  tar -xzf $remote_tmp/deploy_bundle.tar.gz -C $SERVER_DIR; \
  if [ '$SERVER_DEPLOY_IMAGE_TRANSPORT' = remote-build ]; then \
    find $SERVER_DIR/OmniRoute $SERVER_DIR/open-webui $SERVER_DIR/openclaw -type f -name '._*' -delete 2>/dev/null || true; \
  fi; \
  mkdir -p \$(dirname $SERVER_ENV_FILE); \
  if [ ! -f $SERVER_ENV_FILE ]; then cp $SERVER_DIR/deploy/env/stack.server.env.example $SERVER_ENV_FILE; fi; \
  LOCALAGENT_USE_REGISTRY_IMAGES=$([[ "$SERVER_DEPLOY_IMAGE_TRANSPORT" == "registry" ]] && printf true || printf false) \
  LOCALAGENT_IMAGE_REGISTRY=$LOCALAGENT_IMAGE_REGISTRY \
  LOCALAGENT_PLATFORM_NAMESPACE=$LOCALAGENT_PLATFORM_NAMESPACE \
  LOCALAGENT_APPS_NAMESPACE=$LOCALAGENT_APPS_NAMESPACE \
  LOCALAGENT_IMAGE_TAG=$LOCALAGENT_IMAGE_TAG \
    bash $SERVER_DIR/deploy/scripts/reconcile_app_image_env.sh server $SERVER_ENV_FILE; \
  TRAEFIK_HTTP_PORT='$SERVER_TRAEFIK_HTTP_PORT' TRAEFIK_HTTPS_PORT='$SERVER_TRAEFIK_HTTPS_PORT' \
    bash $SERVER_DIR/deploy/scripts/ensure_https_env.sh $SERVER_ENV_FILE; \
  LA_DATA_ROOT_VALUE=\$(sed -n 's/^LA_DATA_ROOT=//p' $SERVER_ENV_FILE | tail -n 1); \
  bash $SERVER_DIR/deploy/scripts/bootstrap_data_dirs.sh \${LA_DATA_ROOT_VALUE:-/data/localagent}; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/bootstrap_extra_ca.sh; \
  if [ '$SERVER_DEPLOY_IMAGE_TRANSPORT' = registry ]; then \
    ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/stack.sh platform pull; \
    ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/stack.sh apps pull omniroute open-webui openclaw-gateway openclaw-cli; \
  fi; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/stack.sh platform up -d; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh platform postgres-primary 180; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh platform redis 180; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/bootstrap_openclaw.sh; \
  if [ '$SERVER_DEPLOY_IMAGE_TRANSPORT' = tar ]; then gzip -dc $remote_tmp/app_images.tar.gz | docker load; fi; \
  if [ '$SERVER_DEPLOY_IMAGE_TRANSPORT' = remote-build ]; then ENV_FILE=$SERVER_ENV_FILE BUILDKIT_PROGRESS=plain bash $SERVER_DIR/deploy/scripts/build_app_images.sh omniroute open-webui openclaw; fi; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/stack.sh apps up -d --no-build --no-deps omniroute; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh apps omniroute 420; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/bootstrap_app_clients.sh; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/stack.sh apps up -d --no-build --no-deps open-webui openclaw-gateway; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh apps open-webui 300; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/wait_for_service_health.sh apps openclaw-gateway 300; \
  ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/stack.sh apps up -d --no-build --no-deps openclaw-cli; \
  rm -rf $remote_tmp"

echo "[5/6] Healthcheck"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "set -euo pipefail; ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/healthcheck.sh server"

echo "[6/6] Smoke test"
"${SSH_BASE[@]}" "$SERVER_REMOTE" "set -euo pipefail; ENV_FILE=$SERVER_ENV_FILE bash $SERVER_DIR/deploy/scripts/smoke_stack.sh server"

echo "OK: server deploy complete using ${SERVER_DEPLOY_IMAGE_TRANSPORT} image transport."
