#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Create it first:" >&2
  echo "  cp \"$DEPLOY_DIR/env/stack.env.example\" \"$ENV_FILE\"" >&2
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
  local key="$1"
  local value="$2"
  local tmp_file
  tmp_file="$(mktemp "${ENV_FILE}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN {
      prefix = key "=";
      replaced = 0;
    }
    index($0, prefix) == 1 && replaced == 0 {
      print prefix value;
      replaced = 1;
      next;
    }
    {
      print $0;
    }
    END {
      if (replaced == 0) {
        print prefix value;
      }
    }
  ' "$ENV_FILE" >"$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
}

is_placeholder_key() {
  local value="$1"
  [[ -z "$value" || "$value" == "bootstrap" || "$value" == "auto" || "$value" == "change-this-app-key" ]]
}

json_escape() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]));' "${1:-}"
}

OMNIROUTE_API_PORT="${OMNIROUTE_API_PORT:-$(read_env_value OMNIROUTE_API_PORT || true)}"
if [[ -z "$OMNIROUTE_API_PORT" ]]; then
  OMNIROUTE_API_PORT="20129"
fi
OMNIROUTE_SELF_BASE_URL="http://127.0.0.1:${OMNIROUTE_API_PORT}/v1"
OMNIROUTE_NETWORK_BASE_URL="http://omniroute:${OMNIROUTE_API_PORT}/v1"

OPENWEBUI_ENV_VALUE="$(read_env_value OPENWEBUI_OPENAI_API_KEY || true)"
OPENCLAW_ENV_VALUE="$(read_env_value OPENCLAW_OPENAI_API_KEY || true)"
REDIS_PASSWORD_VALUE="${REDIS_PASSWORD:-$(read_env_value REDIS_PASSWORD || true)}"

echo "Reconciling OmniRoute app API keys..."

resolve_app_key() {
  local app_name="$1"
  local env_key="$2"
  local env_value="$3"

  bash "$DEPLOY_DIR/scripts/stack.sh" apps exec -T omniroute node - "$app_name" "$env_key" "$env_value" <<'NODE'
const Database = require("better-sqlite3");
const crypto = require("node:crypto");

const appName = process.argv[2];
const envKey = process.argv[3];
const envValue = process.argv[4] || "";
const db = new Database("/app/data/storage.sqlite");
db.pragma("busy_timeout = 5000");

const isPlaceholder = (value) =>
  !value || value === "bootstrap" || value === "auto" || value === "change-this-app-key";
const now = new Date().toISOString();
const targetName = `localagent-${appName}`;

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
  desiredKey = `sk-localagent-${crypto.randomBytes(24).toString("hex")}`;
  db.prepare(
    "INSERT INTO api_keys (id, name, key, machine_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(`ak_${crypto.randomUUID()}`, targetName, desiredKey, null, now);
}

process.stdout.write(desiredKey);
NODE
}

OPENWEBUI_APP_KEY="$(resolve_app_key "openwebui" "OPENWEBUI_OPENAI_API_KEY" "$OPENWEBUI_ENV_VALUE")"
OPENCLAW_APP_KEY="$(resolve_app_key "openclaw" "OPENCLAW_OPENAI_API_KEY" "$OPENCLAW_ENV_VALUE")"

if [[ "$OPENWEBUI_ENV_VALUE" != "$OPENWEBUI_APP_KEY" ]]; then
  set_env_value "OPENWEBUI_OPENAI_API_KEY" "$OPENWEBUI_APP_KEY"
fi
if [[ "$OPENCLAW_ENV_VALUE" != "$OPENCLAW_APP_KEY" ]]; then
  set_env_value "OPENCLAW_OPENAI_API_KEY" "$OPENCLAW_APP_KEY"
fi

echo "Syncing OpenWebUI runtime config..."
bash "$DEPLOY_DIR/scripts/stack.sh" platform exec -T postgres-primary \
  psql -U localagent -d openwebui -v ON_ERROR_STOP=1 \
  -v openai_url="$OMNIROUTE_NETWORK_BASE_URL" \
  -v openai_key="$OPENWEBUI_APP_KEY" <<'SQL'
INSERT INTO config (id, data, version, created_at, updated_at)
SELECT 1, '{"version":0}'::json, 0, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM config);

UPDATE config
SET data = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(COALESCE(data, '{}'::json)::jsonb, '{openai,enable}', 'true'::jsonb, true),
                '{openai,api_base_urls}',
                to_jsonb(ARRAY[:'openai_url']),
                true
              ),
              '{openai,api_keys}',
              to_jsonb(ARRAY[:'openai_key']),
              true
            ),
            '{openai,api_configs}',
            '{"0":{"enable":true}}'::jsonb,
            true
          )::json,
    updated_at = NOW();
SQL

if [[ -n "$REDIS_PASSWORD_VALUE" ]]; then
  echo "Syncing OpenWebUI Redis config..."
  OPENWEBUI_BASE_URLS_JSON="$(node -e 'process.stdout.write(JSON.stringify([process.argv[1]]));' "$OMNIROUTE_NETWORK_BASE_URL")"
  OPENWEBUI_KEYS_JSON="$(node -e 'process.stdout.write(JSON.stringify([process.argv[1]]));' "$OPENWEBUI_APP_KEY")"
  OPENWEBUI_CONFIGS_JSON='{"0":{"enable":true}}'

  bash "$DEPLOY_DIR/scripts/stack.sh" platform exec -T redis \
    redis-cli -a "$REDIS_PASSWORD_VALUE" \
    SET open-webui:config:ENABLE_OPENAI_API true >/dev/null
  bash "$DEPLOY_DIR/scripts/stack.sh" platform exec -T redis \
    redis-cli -a "$REDIS_PASSWORD_VALUE" \
    SET open-webui:config:OPENAI_API_BASE_URLS "$OPENWEBUI_BASE_URLS_JSON" >/dev/null
  bash "$DEPLOY_DIR/scripts/stack.sh" platform exec -T redis \
    redis-cli -a "$REDIS_PASSWORD_VALUE" \
    SET open-webui:config:OPENAI_API_KEYS "$OPENWEBUI_KEYS_JSON" >/dev/null
  bash "$DEPLOY_DIR/scripts/stack.sh" platform exec -T redis \
    redis-cli -a "$REDIS_PASSWORD_VALUE" \
    SET open-webui:config:OPENAI_API_CONFIGS "$OPENWEBUI_CONFIGS_JSON" >/dev/null
  bash "$DEPLOY_DIR/scripts/stack.sh" platform exec -T redis \
    redis-cli -a "$REDIS_PASSWORD_VALUE" \
    DEL open-webui:models >/dev/null
else
  echo "WARN: REDIS_PASSWORD is empty; skipping OpenWebUI Redis config sync." >&2
fi

echo "Discovering OmniRoute catalog for OpenClaw..."
if ! DISCOVERED_MODELS_JSON="$(
  bash "$DEPLOY_DIR/scripts/stack.sh" apps exec -T omniroute node - "$OMNIROUTE_SELF_BASE_URL" "$OPENCLAW_APP_KEY" <<'NODE'
const baseUrl = process.argv[2];
const apiKey = process.argv[3];

async function main() {
  let response;
  let lastError = null;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}/models`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (response.ok) {
        break;
      }
      lastError = new Error(`Failed to fetch OmniRoute models: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!response || !response.ok) {
    throw lastError || new Error("Failed to fetch OmniRoute models");
  }

  const payload = await response.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const models = data
    .map((entry) => {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
        return null;
      }
      return {
        id: entry.id,
        name:
          typeof entry.id === "string"
            ? entry.id
                .split("/")
                .slice(-1)[0]
                .replace(/[-_]/g, " ")
                .replace(/\b\w/g, (char) => char.toUpperCase())
            : "Model",
      };
    })
    .filter(Boolean);

  process.stdout.write(JSON.stringify(models));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE
)"
then
  echo "WARN: OmniRoute catalog discovery failed during bootstrap; using fallback OpenClaw model list." >&2
  DISCOVERED_MODELS_JSON=""
fi

if [[ -z "$DISCOVERED_MODELS_JSON" || "$DISCOVERED_MODELS_JSON" == "[]" ]]; then
  DISCOVERED_MODELS_JSON='[
    {"id":"chatgpt-web2api/gpt-5.2","name":"GPT-5.2"},
    {"id":"chatgpt-web2api/gpt-5.1","name":"GPT-5.1"},
    {"id":"chatgpt-web2api/gpt-5","name":"GPT-5"}
  ]'
fi

OPENCLAW_DISABLE_DEVICE_AUTH_RAW="${OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH:-$(read_env_value OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH || true)}"
if [[ "$OPENCLAW_DISABLE_DEVICE_AUTH_RAW" =~ ^(1|true|TRUE|True|yes|YES|on|ON)$ ]]; then
  OPENCLAW_DISABLE_DEVICE_AUTH="true"
else
  OPENCLAW_DISABLE_DEVICE_AUTH="false"
fi

OPENCLAW_CONFIG_DIR="${LA_DATA_ROOT:-$(read_env_value LA_DATA_ROOT || true)}"
if [[ -z "$OPENCLAW_CONFIG_DIR" ]]; then
  OPENCLAW_CONFIG_DIR="/data/localagent"
fi
OPENCLAW_CONFIG_FILE="$OPENCLAW_CONFIG_DIR/apps/openclaw/config/openclaw.json"
mkdir -p "$(dirname "$OPENCLAW_CONFIG_FILE")"

echo "Reconciling OpenClaw provider + default model config..."
node - "$OPENCLAW_CONFIG_FILE" "$DISCOVERED_MODELS_JSON" "$OMNIROUTE_NETWORK_BASE_URL" "$OPENCLAW_DISABLE_DEVICE_AUTH" <<'NODE'
const fs = require("node:fs");

const configPath = process.argv[2];
const discoveredModels = JSON.parse(process.argv[3] || "[]");
const baseUrl = process.argv[4];
const disableDeviceAuth = process.argv[5] === "true";

const preferredIds = [
  "chatgpt-web2api/gpt-5.2",
  "chatgpt-web2api/gpt-5.1",
  "chatgpt-web2api/gpt-5",
];
const discoveredIds = discoveredModels
  .map((entry) => (entry && typeof entry.id === "string" ? entry.id : null))
  .filter(Boolean);
const defaultModelId =
  preferredIds.find((id) => discoveredIds.includes(id)) || discoveredIds[0] || preferredIds[0];
const fallbackModelIds = discoveredIds.filter((id) => id !== defaultModelId).slice(0, 2);

let config = {};
if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, "utf8").trim();
  if (raw) {
    config = JSON.parse(raw);
  }
}

config.gateway = config.gateway && typeof config.gateway === "object" ? config.gateway : {};
config.gateway.auth =
  config.gateway.auth && typeof config.gateway.auth === "object" ? config.gateway.auth : {};
config.gateway.auth.token = "${OPENCLAW_GATEWAY_TOKEN}";
config.gateway.controlUi =
  config.gateway.controlUi && typeof config.gateway.controlUi === "object"
    ? config.gateway.controlUi
    : {};
config.gateway.controlUi.dangerouslyDisableDeviceAuth = disableDeviceAuth;

config.models = config.models && typeof config.models === "object" ? config.models : {};
if (!config.models.mode) {
  config.models.mode = "merge";
}
config.models.providers =
  config.models.providers && typeof config.models.providers === "object" ? config.models.providers : {};
config.models.providers.omniroute = {
  ...(config.models.providers.omniroute && typeof config.models.providers.omniroute === "object"
    ? config.models.providers.omniroute
    : {}),
  api: "openai-completions",
  auth: "api-key",
  apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
  baseUrl,
  models: discoveredModels,
};

config.agents = config.agents && typeof config.agents === "object" ? config.agents : {};
config.agents.defaults =
  config.agents.defaults && typeof config.agents.defaults === "object" ? config.agents.defaults : {};

const currentModelSetting = config.agents.defaults.model;
const currentPrimary =
  typeof currentModelSetting === "string"
    ? currentModelSetting
    : currentModelSetting && typeof currentModelSetting === "object"
      ? currentModelSetting.primary
      : null;

const shouldSeedOmniRouteDefaults =
  !currentPrimary ||
  /^openai(?:\/|$)/.test(currentPrimary) ||
  /^openai-codex(?:\/|$)/.test(currentPrimary);

if (shouldSeedOmniRouteDefaults) {
  config.agents.defaults.model = {
    primary: `omniroute/${defaultModelId}`,
    ...(fallbackModelIds.length > 0
      ? { fallbacks: fallbackModelIds.map((modelId) => `omniroute/${modelId}`) }
      : {}),
  };
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
NODE

echo "Restarting OpenWebUI + OpenClaw Gateway to apply reconciled auth/config..."
bash "$DEPLOY_DIR/scripts/stack.sh" apps up -d --force-recreate --no-deps open-webui openclaw-gateway

echo "App client bootstrap complete."
