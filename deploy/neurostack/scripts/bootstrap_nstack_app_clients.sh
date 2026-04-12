#!/usr/bin/env bash
# NeuroStack bootstrap app clients — adapted từ deploy/scripts/bootstrap_app_clients.sh
# Sự khác biệt chính:
#   - Đọc NS_DATA_ROOT thay vì LA_DATA_ROOT
#   - Dùng OMNIROUTER_API_PORT (21129) thay vì OMNIROUTE_API_PORT (20129)
#   - App key names: "neurostack-openwebui", "neurostack-openclaw"
#   - Dùng nstack_stack.sh thay vì stack.sh
#   - DB name: neurostack (không phải openwebui)
#   - Redis key prefix: ns-open-webui
set -euo pipefail

NEUROSTACK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$(cd -- "$NEUROSTACK_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/nstack.local.env}"

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

set_env_value() {
  local key="$1" value="$2"
  local tmp_file
  tmp_file="$(mktemp "${ENV_FILE}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { prefix = key "="; replaced = 0; }
    index($0, prefix) == 1 && replaced == 0 { print prefix value; replaced = 1; next; }
    { print $0; }
    END { if (replaced == 0) { print prefix value; } }
  ' "$ENV_FILE" > "$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
}

NSTACK_STACK="$NEUROSTACK_DIR/scripts/nstack_stack.sh"

# OmniRouter uses OMNIROUTER_API_PORT (21129) — not OMNIROUTE_API_PORT
OMNIROUTER_API_PORT="$(read_env_value OMNIROUTER_API_PORT || echo '21129')"
OMNIROUTER_SELF_BASE_URL="http://127.0.0.1:${OMNIROUTER_API_PORT}/v1"
OMNIROUTER_NETWORK_BASE_URL="http://omnirouter:${OMNIROUTER_API_PORT}/v1"

OPENWEBUI_ENV_VALUE="$(read_env_value OPENWEBUI_OPENAI_API_KEY || true)"
OPENCLAW_ENV_VALUE="$(read_env_value OPENCLAW_OPENAI_API_KEY || true)"
REDIS_PASSWORD_VALUE="$(read_env_value REDIS_PASSWORD || true)"
POSTGRES_USER_VALUE="$(read_env_value POSTGRES_USER || echo 'neurostack')"
POSTGRES_DB_VALUE="$(read_env_value POSTGRES_DB || echo 'neurostack')"
REDIS_KEY_PREFIX="$(read_env_value OPENWEBUI_REDIS_KEY_PREFIX || echo 'ns-open-webui')"

echo "Reconciling OmniRouter app API keys (NeuroStack brand)..."

resolve_app_key() {
  local app_name="$1"
  local env_value="$2"
  # Run node inside the omnirouter container
  ENV_FILE="$ENV_FILE" bash "$NSTACK_STACK" apps exec -T omnirouter node - \
    "$app_name" "$env_value" <<'NODE'
const Database = require("better-sqlite3");
const crypto = require("node:crypto");

const appName = process.argv[2];
const envValue = process.argv[3] || "";
const db = new Database("/app/data/storage.sqlite");
db.pragma("busy_timeout = 5000");

const isPlaceholder = (value) =>
  !value || value === "bootstrap" || value === "auto" || value === "change-this-app-key";
const now = new Date().toISOString();
// NeuroStack app key names: "neurostack-openwebui", "neurostack-openclaw"
const targetName = `neurostack-${appName}`;

const byName = db.prepare("SELECT key FROM api_keys WHERE name = ? LIMIT 1").get(targetName);
const byKey = !isPlaceholder(envValue)
  ? db.prepare("SELECT key FROM api_keys WHERE key = ? LIMIT 1").get(envValue)
  : undefined;

let desiredKey = "";
if (!isPlaceholder(envValue)) {
  desiredKey = envValue;
  if (!byKey) {
    if (byName) {
      db.prepare("UPDATE api_keys SET key = ? WHERE name = ?").run(desiredKey, targetName);
    } else {
      db.prepare(
        "INSERT INTO api_keys (id, name, key, machine_id, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(`ak_${crypto.randomUUID()}`, targetName, desiredKey, null, now);
    }
  }
} else if (byName?.key) {
  desiredKey = String(byName.key);
} else {
  desiredKey = `sk-nstack-${crypto.randomBytes(24).toString("hex")}`;
  db.prepare(
    "INSERT INTO api_keys (id, name, key, machine_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(`ak_${crypto.randomUUID()}`, targetName, desiredKey, null, now);
}

process.stdout.write(desiredKey);
NODE
}

OPENWEBUI_APP_KEY="$(resolve_app_key "openwebui" "$OPENWEBUI_ENV_VALUE")"
OPENCLAW_APP_KEY="$(resolve_app_key "openclaw" "$OPENCLAW_ENV_VALUE")"

if [[ "$OPENWEBUI_ENV_VALUE" != "$OPENWEBUI_APP_KEY" ]]; then
  set_env_value "OPENWEBUI_OPENAI_API_KEY" "$OPENWEBUI_APP_KEY"
fi
if [[ "$OPENCLAW_ENV_VALUE" != "$OPENCLAW_APP_KEY" ]]; then
  set_env_value "OPENCLAW_OPENAI_API_KEY" "$OPENCLAW_APP_KEY"
fi

echo "Syncing OpenWebUI runtime config to PostgreSQL (DB: $POSTGRES_DB_VALUE)..."
# Best-effort: config table may not exist on first deploy (OpenWebUI creates it).
# Redis sync below is the primary mechanism; this is a fallback.
ENV_FILE="$ENV_FILE" bash "$NSTACK_STACK" platform exec -T postgres-primary \
  psql -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -v ON_ERROR_STOP=0 \
  -v openai_url="$OMNIROUTER_NETWORK_BASE_URL" \
  -v openai_key="$OPENWEBUI_APP_KEY" <<'SQL'
-- Skip if config table doesn't exist yet (OpenWebUI migration creates it on first boot)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'config') THEN
    INSERT INTO config (id, data, version, created_at, updated_at)
    SELECT 1, '{"version":0}'::json, 0, NOW(), NOW()
    WHERE NOT EXISTS (SELECT 1 FROM config);

    UPDATE config
    SET data = jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(COALESCE(data, '{}'::json)::jsonb, '{openai,enable}', 'true'::jsonb, true),
                    '{openai,api_base_urls}',
                    to_jsonb(ARRAY[current_setting('app.openai_url', true)]),
                    true
                  ),
                  '{openai,api_keys}',
                  to_jsonb(ARRAY[current_setting('app.openai_key', true)]),
                  true
                ),
                '{openai,api_configs}',
                '{"0":{"enable":true}}'::jsonb,
                true
              )::json,
        updated_at = NOW();
  ELSE
    RAISE NOTICE 'config table does not exist yet — skipping Postgres sync (Redis sync is primary)';
  END IF;
END $$;
SQL

if [[ -n "$REDIS_PASSWORD_VALUE" ]]; then
  echo "Syncing OpenWebUI Redis config (prefix: $REDIS_KEY_PREFIX)..."
  OPENWEBUI_BASE_URLS_JSON="$(node -e 'process.stdout.write(JSON.stringify([process.argv[1]]));' "$OMNIROUTER_NETWORK_BASE_URL")"
  OPENWEBUI_KEYS_JSON="$(node -e 'process.stdout.write(JSON.stringify([process.argv[1]]));' "$OPENWEBUI_APP_KEY")"
  OPENWEBUI_CONFIGS_JSON='{"0":{"enable":true}}'

  for key in "config:ENABLE_OPENAI_API true" \
             "config:OPENAI_API_BASE_URLS $OPENWEBUI_BASE_URLS_JSON" \
             "config:OPENAI_API_KEYS $OPENWEBUI_KEYS_JSON" \
             "config:OPENAI_API_CONFIGS $OPENWEBUI_CONFIGS_JSON"; do
    redis_key="$(echo "$key" | cut -d' ' -f1)"
    redis_val="$(echo "$key" | cut -d' ' -f2-)"
    ENV_FILE="$ENV_FILE" bash "$NSTACK_STACK" platform exec -T redis \
      redis-cli -a "$REDIS_PASSWORD_VALUE" \
      SET "${REDIS_KEY_PREFIX}:${redis_key}" "$redis_val" > /dev/null
  done

  ENV_FILE="$ENV_FILE" bash "$NSTACK_STACK" platform exec -T redis \
    redis-cli -a "$REDIS_PASSWORD_VALUE" \
    DEL "${REDIS_KEY_PREFIX}:models" > /dev/null || true
else
  echo "WARN: REDIS_PASSWORD empty; skipping Redis config sync." >&2
fi

echo "Discovering OmniRouter catalog for OpenClaw..."
DISCOVERED_MODELS_JSON="$(
  ENV_FILE="$ENV_FILE" bash "$NSTACK_STACK" apps exec -T omnirouter node - \
    "$OMNIROUTER_SELF_BASE_URL" "$OPENCLAW_APP_KEY" <<'NODE' 2>/dev/null || echo "[]"
const baseUrl = process.argv[2];
const apiKey = process.argv[3];
async function main() {
  let response; let lastError = null;
  for (let i = 1; i <= 10; i++) {
    try {
      response = await fetch(`${baseUrl}/models`, { headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` } });
      if (response.ok) break;
    } catch (e) { lastError = e; }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!response?.ok) throw lastError || new Error("Failed to fetch models");
  const { data = [] } = await response.json();
  process.stdout.write(JSON.stringify(
    data.filter(e => e?.id).map(e => ({
      id: e.id,
      name: e.id.split("/").slice(-1)[0].replace(/[-_]/g," ").replace(/\b\w/g,c=>c.toUpperCase())
    }))
  ));
}
main().catch(e => { process.stderr.write(String(e)); process.exit(1); });
NODE
)"

if [[ -z "$DISCOVERED_MODELS_JSON" || "$DISCOVERED_MODELS_JSON" == "[]" ]]; then
  DISCOVERED_MODELS_JSON='[{"id":"chatgpt-web2api/gpt-5","name":"GPT-5"}]'
fi

# Sync OpenClaw config
NS_DATA_ROOT_VAL="$(read_env_value NS_DATA_ROOT || echo '/data/neurostack')"
OPENCLAW_CONFIG_FILE="$NS_DATA_ROOT_VAL/apps/openclaw/config/openclaw.json"
mkdir -p "$(dirname "$OPENCLAW_CONFIG_FILE")"

OPENCLAW_DISABLE_DEVICE_AUTH_RAW="$(read_env_value OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH || echo 'false')"
if [[ "$OPENCLAW_DISABLE_DEVICE_AUTH_RAW" =~ ^(1|true|TRUE|True|yes|YES|on|ON)$ ]]; then
  OPENCLAW_DISABLE_DEVICE_AUTH="true"
else
  OPENCLAW_DISABLE_DEVICE_AUTH="false"
fi
OPENCLAW_GW_TOKEN="$(read_env_value OPENCLAW_GATEWAY_TOKEN || echo '')"

echo "Reconciling OpenClaw provider config..."
node - "$OPENCLAW_CONFIG_FILE" "$DISCOVERED_MODELS_JSON" "$OMNIROUTER_NETWORK_BASE_URL" \
  "$OPENCLAW_DISABLE_DEVICE_AUTH" "$OPENCLAW_GW_TOKEN" <<'NODE'
const fs = require("node:fs");
const configPath = process.argv[2];
const discoveredModels = JSON.parse(process.argv[3] || "[]");
const baseUrl = process.argv[4];
const disableDeviceAuth = process.argv[5] === "true";
const gatewayToken = process.argv[6] || "";

const defaultModelId = discoveredModels[0]?.id || "chatgpt-web2api/gpt-5";
const fallbackIds = discoveredModels.slice(1, 3).map(m => m.id);

let config = {};
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, "utf8").trim()) || {}; } catch {}
}

config.gateway = config.gateway || {};
config.gateway.auth = config.gateway.auth || {};
if (gatewayToken) config.gateway.auth.token = gatewayToken;
config.gateway.controlUi = config.gateway.controlUi || {};
config.gateway.controlUi.dangerouslyDisableDeviceAuth = disableDeviceAuth;

config.models = config.models || { mode: "merge", providers: {} };
if (!config.models.mode) config.models.mode = "merge";
config.models.providers = config.models.providers || {};
config.models.providers.omnirouter = {
  ...(config.models.providers.omnirouter || {}),
  api: "openai-completions",
  auth: "api-key",
  apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
  baseUrl,
  models: discoveredModels,
};

config.agents = config.agents || { defaults: {} };
config.agents.defaults = config.agents.defaults || {};
const currentModel = config.agents.defaults.model;
const currentPrimary = typeof currentModel === "string" ? currentModel
  : currentModel?.primary || null;

const shouldSeedDefaults = !currentPrimary
  || /^openai(?:\/|$)/.test(currentPrimary)
  || /^openai-codex(?:\/|$)/.test(currentPrimary);

if (shouldSeedDefaults) {
  config.agents.defaults.model = {
    primary: `omnirouter/${defaultModelId}`,
    ...(fallbackIds.length > 0 ? { fallbacks: fallbackIds.map(id => `omnirouter/${id}`) } : {}),
  };
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
NODE

echo "Restarting OpenWebUI + OpenClaw Gateway to apply config..."
ENV_FILE="$ENV_FILE" bash "$NSTACK_STACK" apps up -d --force-recreate --no-deps open-webui openclaw-gateway

echo "NeuroStack app client bootstrap complete."
