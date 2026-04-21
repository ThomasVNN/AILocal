#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PREFERRED_SMOKE_MODELS=(
  "chatgpt-web2api/gpt-5.2"
  "chatgpt-web2api/gpt-5.1"
  "perplexity-web2api/sonar-pro"
  "perplexity-web2api/sonar"
)
SUPPORTED_SMOKE_PROVIDER_PREFIXES=(
  "chatgpt-web2api/"
  "perplexity-web2api/"
)

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

resolve_smoke_models() {
  local models_payload="$1"
  node - "$models_payload" "${PREFERRED_SMOKE_MODELS[@]}" -- "${SUPPORTED_SMOKE_PROVIDER_PREFIXES[@]}" <<'NODE'
const payload = JSON.parse(process.argv[2]);
const separatorIndex = process.argv.indexOf("--");
const preferred = process.argv.slice(3, separatorIndex);
const supportedPrefixes = process.argv.slice(separatorIndex + 1);
const data = Array.isArray(payload.data) ? payload.data : [];
const ids = data.map((entry) => entry && entry.id).filter(Boolean);
const resolved = [];
const seen = new Set();

function pushModel(id) {
  if (!id || seen.has(id)) {
    return;
  }
  seen.add(id);
  resolved.push(id);
}

for (const id of preferred) {
  if (ids.includes(id)) {
    pushModel(id);
  }
}

for (const id of ids) {
  if (supportedPrefixes.some((prefix) => id.startsWith(prefix))) {
    pushModel(id);
  }
}

process.stdout.write(resolved.join("\n"));
NODE
}

has_required_direct_provider() {
  local provider_summary="$1"
  node - "$provider_summary" <<'NODE'
const rows = JSON.parse(process.argv[2] || "[]");
const required = new Set(["chatgpt-web2api", "perplexity-web2api"]);
const hasProvider = Array.isArray(rows)
  ? rows.some((row) => required.has(row?.provider) && Number(row?.active || 0) > 0)
  : false;
process.stdout.write(hasProvider ? "yes" : "no");
NODE
}

count_active_direct_providers() {
  local provider_summary="$1"
  node - "$provider_summary" <<'NODE'
const rows = JSON.parse(process.argv[2] || "[]");
const total = Array.isArray(rows)
  ? rows.reduce((sum, row) => sum + Number(row?.active || 0), 0)
  : 0;
process.stdout.write(String(total));
NODE
}

classify_chat_response() {
  local response="$1"
  node - "$response" <<'NODE'
const raw = process.argv[2] ?? "";

function extractContent(payload) {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.delta?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry.text === "string") return entry.text;
        return "";
      })
      .join(" ");
  }
  return "";
}

function extractSseContent(input) {
  let content = "";
  for (const line of input.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      content += extractContent(JSON.parse(data));
    } catch {
      // Ignore malformed SSE frames and let final classification fail cleanly.
    }
  }
  return content;
}

function matchesExpectedContent(content) {
  return /^\s*(OK|2)[.!]?\s*$/i.test(content);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  const sseContent = extractSseContent(raw);
  process.stdout.write(matchesExpectedContent(sseContent) ? "success" : "failure");
  process.exit(0);
}

const errorMessage = String(payload?.error?.message ?? payload?.message ?? "");
const normalizedError = errorMessage.toLowerCase();
if (
  normalizedError &&
  [
    "429",
    "rate limit",
    "rate limited",
    "usage limit",
    "quota",
    "reset after",
    "too many requests",
  ].some((needle) => normalizedError.includes(needle))
) {
  process.stdout.write("retryable");
  process.exit(0);
}

const content = extractContent(payload);
if (matchesExpectedContent(content)) {
  process.stdout.write("success");
  process.exit(0);
}

process.stdout.write("failure");
NODE
}

summarize_chat_response() {
  local response="$1"
  node - "$response" <<'NODE'
const raw = process.argv[2] ?? "";

function truncate(value) {
  if (value.length <= 220) {
    return value;
  }
  return `${value.slice(0, 217)}...`;
}

function extractContent(payload) {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.delta?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry.text === "string") return entry.text;
        return "";
      })
      .join(" ")
      .trim();
  }
  return "";
}

function extractSseContent(input) {
  let content = "";
  for (const line of input.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      content += extractContent(JSON.parse(data));
    } catch {
      // Fall through to the raw body summary when frames are malformed.
    }
  }
  return content.trim();
}

try {
  const payload = JSON.parse(raw);
  const errorMessage = String(payload?.error?.message ?? payload?.message ?? "").trim();
  if (errorMessage) {
    process.stdout.write(truncate(errorMessage));
    process.exit(0);
  }

  const content = extractContent(payload);
  if (content) {
    process.stdout.write(truncate(content));
    process.exit(0);
  }

  process.stdout.write(truncate(JSON.stringify(payload)));
} catch {
  const sseContent = extractSseContent(raw);
  if (sseContent) {
    process.stdout.write(truncate(sseContent));
    process.exit(0);
  }
  process.stdout.write(truncate(raw));
}
NODE
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

main() {
  local mode="${1:-local}"
  ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"

  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing env file: $ENV_FILE" >&2
    exit 1
  fi

  TRAEFIK_TLS_ENABLED="$(read_env_value TRAEFIK_TLS_ENABLED || echo true)"
  TRAEFIK_HTTP_PORT="$(read_env_value TRAEFIK_HTTP_PORT || echo 80)"
  TRAEFIK_HTTPS_PORT="$(read_env_value TRAEFIK_HTTPS_PORT || echo 443)"
  OMNIROUTE_HOST="$(read_env_value OMNIROUTE_HOST || echo router.localagent.local)"
  OMNIROUTE_API_HOST="$(read_env_value OMNIROUTE_API_HOST || echo api.localagent.local)"
  REDIS_PASSWORD="$(read_env_value REDIS_PASSWORD || true)"
  OPENWEBUI_OPENAI_API_KEY="$(read_env_value OPENWEBUI_OPENAI_API_KEY || true)"
  OPENCLAW_OPENAI_API_KEY="$(read_env_value OPENCLAW_OPENAI_API_KEY || true)"
  OMNIROUTE_API_PORT="$(read_env_value OMNIROUTE_API_PORT || echo 20129)"
  LA_DATA_ROOT="$(read_env_value LA_DATA_ROOT || echo /data/localagent)"
  expected_network_base_url="http://omniroute:${OMNIROUTE_API_PORT}/v1"

  echo "Smoke test mode=$mode"

  echo "[1/5] Verify OmniRoute direct router catalog"
  models_payload="$(curl_host "$OMNIROUTE_HOST" "/v1/models")"
  model_count="$(node -e 'const payload = JSON.parse(process.argv[1]); process.stdout.write(String(Array.isArray(payload.data) ? payload.data.length : 0));' "$models_payload")"
  if [[ "${model_count:-0}" -lt 1 ]]; then
    echo "FAIL: OmniRoute returned no models" >&2
    exit 1
  fi
  smoke_models=()
  while IFS= read -r smoke_model || [[ -n "$smoke_model" ]]; do
    if [[ -n "$smoke_model" ]]; then
      smoke_models+=("$smoke_model")
    fi
  done < <(resolve_smoke_models "$models_payload")
  if [[ "${#smoke_models[@]}" -lt 1 ]]; then
    echo "FAIL: OmniRoute catalog exposed no supported central smoke models" >&2
    exit 1
  fi
  echo "OK: OmniRoute exposes $model_count models on $OMNIROUTE_HOST"

  echo "[2/5] Verify configured direct-routing providers in OmniRoute"
  provider_summary="$(
    bash "$DEPLOY_DIR/scripts/stack.sh" apps exec -T omniroute node <<'NODE'
const Database = require("better-sqlite3");
const db = new Database("/app/data/storage.sqlite", { readonly: true });
const rows = db
  .prepare(
    "select provider, count(*) as total, sum(case when is_active = 1 then 1 else 0 end) as active from provider_connections where provider in ('chatgpt-web2api','perplexity-web2api') group by provider order by provider"
  )
  .all();
process.stdout.write(JSON.stringify(rows));
NODE
  )"
  configured_provider_count="$(count_active_direct_providers "$provider_summary")"
  has_direct_provider="$(has_required_direct_provider "$provider_summary")"
  if [[ "$has_direct_provider" != "yes" ]]; then
    echo "FAIL: OmniRoute has no active chatgpt-web2api or perplexity-web2api provider connection" >&2
    exit 1
  fi
  echo "OK: OmniRoute has $configured_provider_count active direct provider connection(s)"

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
  local smoke_model=""
  local chat_payload=""
  local chat_response=""
  local classification=""
  local summary=""
  local attempt_errors=()
  local attempt_error_text=""
  for smoke_model in "${smoke_models[@]}"; do
    echo "Trying model: $smoke_model"
    chat_payload="$(node -e 'process.stdout.write(JSON.stringify({model: process.argv[1], messages: [{role: "user", content: "What is 1+1? Answer with 2 only."}]}));' "$smoke_model")"
    if ! chat_response="$(
      curl_host "$OMNIROUTE_HOST" "/v1/chat/completions" \
        -H "Authorization: Bearer ${OPENWEBUI_OPENAI_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$chat_payload"
    )"; then
      attempt_errors+=("$smoke_model [failure] transport_error")
      echo "WARN: transport error while testing $smoke_model"
      continue
    fi

    classification="$(classify_chat_response "$chat_response")"
    if [[ "$classification" == "success" ]]; then
      echo "OK: Central chat path works via $smoke_model"
      echo "Smoke test passed."
      return 0
    fi

    summary="$(summarize_chat_response "$chat_response")"
    attempt_error_text="$smoke_model [$classification] $summary"
    attempt_errors+=("$attempt_error_text")
    echo "WARN: $attempt_error_text"
  done

  echo "FAIL: OmniRoute chat smoke test did not return expected content from any candidate model" >&2
  printf '%s\n' "${attempt_errors[@]}" >&2
  exit 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
