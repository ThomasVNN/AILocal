#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"
mode="${1:-local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

normalize_bool() {
  case "${1:-}" in
    1|true|TRUE|True|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

curl_host() {
  local host="$1"
  local path="$2"
  shift 2

  if normalize_bool "$TRAEFIK_TLS_ENABLED"; then
    curl -sk --resolve "${host}:${TRAEFIK_HTTPS_PORT}:127.0.0.1" "https://${host}:${TRAEFIK_HTTPS_PORT}${path}" "$@"
  else
    curl -sS -H "Host: ${host}" "http://127.0.0.1:${TRAEFIK_HTTP_PORT}${path}" "$@"
  fi
}

TRAEFIK_TLS_ENABLED="$(read_env_value TRAEFIK_TLS_ENABLED || echo true)"
TRAEFIK_HTTP_PORT="$(read_env_value TRAEFIK_HTTP_PORT || echo 80)"
TRAEFIK_HTTPS_PORT="$(read_env_value TRAEFIK_HTTPS_PORT || echo 443)"
OMNIROUTE_API_HOST="$(read_env_value OMNIROUTE_API_HOST || echo api.localagent.local)"
REDIS_PASSWORD="$(read_env_value REDIS_PASSWORD || true)"
OPENWEBUI_OPENAI_API_KEY="$(read_env_value OPENWEBUI_OPENAI_API_KEY || true)"
OPENCLAW_OPENAI_API_KEY="$(read_env_value OPENCLAW_OPENAI_API_KEY || true)"
OMNIROUTE_API_PORT="$(read_env_value OMNIROUTE_API_PORT || echo 20129)"
LA_DATA_ROOT="$(read_env_value LA_DATA_ROOT || echo /data/localagent)"
expected_network_base_url="http://omniroute:${OMNIROUTE_API_PORT}/v1"

echo "Smoke test mode=$mode"

echo "[1/5] Verify OmniRoute public catalog"
models_payload="$(curl_host "$OMNIROUTE_API_HOST" "/v1/models")"
model_count="$(node -e 'const payload = JSON.parse(process.argv[1]); process.stdout.write(String(Array.isArray(payload.data) ? payload.data.length : 0));' "$models_payload")"
if [[ "${model_count:-0}" -lt 1 ]]; then
  echo "FAIL: OmniRoute returned no models" >&2
  exit 1
fi
smoke_model="$(
  node -e '
    const payload = JSON.parse(process.argv[1]);
    const data = Array.isArray(payload.data) ? payload.data : [];
    const ids = new Set(data.map((entry) => entry && entry.id).filter(Boolean));
    const preferred = [
      "chatgpt-web2api/gpt-5.2",
      "chatgpt-web2api/gpt-5.1",
      "perplexity-web2api/sonar-pro",
      "perplexity-web2api/sonar",
      "gemini-web2api/gemini-2.5-pro",
      "gemini-web2api/gemini-2.5-flash",
      "claude/claude-sonnet-4-6",
    ];
    const resolved = preferred.find((id) => ids.has(id)) || data[0]?.id || "";
    process.stdout.write(resolved);
  ' "$models_payload"
)"
echo "OK: OmniRoute exposes $model_count models"

echo "[2/5] Verify configured central providers in OmniRoute"
configured_provider_count="$(
  bash "$DEPLOY_DIR/scripts/stack.sh" apps exec -T omniroute node <<'NODE'
const Database = require("better-sqlite3");
const db = new Database("/app/data/storage.sqlite", { readonly: true });
const row = db
  .prepare(
    "select count(*) as total from provider_connections where provider in ('chatgpt-web2api','perplexity-web2api','gemini-web2api','claude') and is_active = 1"
  )
  .get();
process.stdout.write(String(row?.total ?? 0));
NODE
)"
if [[ "${configured_provider_count:-0}" -lt 1 ]]; then
  echo "FAIL: OmniRoute has no configured ChatGPT/Perplexity/Gemini/Claude provider connections" >&2
  exit 1
fi
echo "OK: OmniRoute has $configured_provider_count configured central provider connection(s)"

echo "[3/5] Verify OpenWebUI runtime points to OmniRoute"
if [[ -n "$REDIS_PASSWORD" ]]; then
  redis_keys_json="$(
    bash "$DEPLOY_DIR/scripts/stack.sh" platform exec -T redis \
      redis-cli -a "$REDIS_PASSWORD" GET open-webui:config:OPENAI_API_KEYS | tr -d '\r'
  )"
  redis_urls_json="$(
    bash "$DEPLOY_DIR/scripts/stack.sh" platform exec -T redis \
      redis-cli -a "$REDIS_PASSWORD" GET open-webui:config:OPENAI_API_BASE_URLS | tr -d '\r'
  )"
  if [[ "$redis_keys_json" == *bootstrap* ]]; then
    echo "FAIL: OpenWebUI Redis config still contains bootstrap API key" >&2
    exit 1
  fi
  if [[ "$redis_urls_json" != *"$expected_network_base_url"* ]]; then
    echo "FAIL: OpenWebUI Redis config does not point to $expected_network_base_url" >&2
    exit 1
  fi
fi

bash "$DEPLOY_DIR/scripts/stack.sh" apps exec -T open-webui python - <<'PY'
import os
import urllib.request

base = os.environ["OPENAI_API_BASE_URL"]
key = os.environ["OPENAI_API_KEY"]
req = urllib.request.Request(
    base + "/models",
    headers={"Authorization": "Bearer " + key},
)
with urllib.request.urlopen(req, timeout=20) as response:
    if response.status != 200:
        raise SystemExit(f"OpenWebUI upstream status={response.status}")
print("OK: OpenWebUI can reach OmniRoute")
PY

echo "[4/5] Verify OpenClaw runtime points to OmniRoute"
node - "$LA_DATA_ROOT" "$expected_network_base_url" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const dataRoot = process.argv[2];
const expectedBaseUrl = process.argv[3];
const configPath = path.join(dataRoot, "apps", "openclaw", "config", "openclaw.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const actualBaseUrl = config?.models?.providers?.omniroute?.baseUrl;
if (actualBaseUrl !== expectedBaseUrl) {
  console.error(`FAIL: OpenClaw config baseUrl=${actualBaseUrl} expected=${expectedBaseUrl}`);
  process.exit(1);
}
console.log(`OK: OpenClaw config baseUrl=${actualBaseUrl}`);
NODE

bash "$DEPLOY_DIR/scripts/stack.sh" apps exec -T openclaw-gateway node - "$OPENCLAW_OPENAI_API_KEY" <<'NODE'
const apiKey = process.argv[2];
fetch("http://omniroute:20129/v1/models", {
  headers: { Authorization: `Bearer ${apiKey}` },
})
  .then(async (response) => {
    if (!response.ok) {
      throw new Error(`status=${response.status}`);
    }
    console.log("OK: OpenClaw can reach OmniRoute");
  })
  .catch((error) => {
    console.error(`FAIL: OpenClaw -> OmniRoute ${error.message}`);
    process.exit(1);
  });
NODE

echo "[5/5] Verify central chat path"
chat_payload="$(node -e 'process.stdout.write(JSON.stringify({model: process.argv[1], messages: [{role: "user", content: "Reply with OK only."}]}));' "$smoke_model")"
chat_response="$(
  curl_host "$OMNIROUTE_API_HOST" "/v1/chat/completions" \
    -H "Authorization: Bearer ${OPENWEBUI_OPENAI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$chat_payload"
)"
if [[ "$chat_response" != *"OK"* ]]; then
  echo "FAIL: OmniRoute chat smoke test did not return expected content" >&2
  echo "$chat_response" >&2
  exit 1
fi
echo "OK: Central chat path works"

echo "Smoke test passed."
