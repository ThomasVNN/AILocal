import { PERPLEXITY_WEB_HEADERS } from "./perplexitySession.ts";

type JsonRecord = Record<string, unknown>;

export type PerplexityDiscoveredModel = {
  id: string;
  name: string;
};

export type PerplexityModelDiscoveryResult = {
  models: PerplexityDiscoveredModel[];
  source: "web_catalog" | "web_settings" | "fallback_static";
  confidence: "high" | "medium" | "low";
  warning?: string;
};

const DISCOVERY_ENDPOINTS = [
  {
    source: "web_catalog" as const,
    url: "https://www.perplexity.ai/rest/models/config",
  },
  {
    source: "web_catalog" as const,
    url: "https://www.perplexity.ai/rest/models",
  },
  {
    source: "web_settings" as const,
    url: "https://www.perplexity.ai/rest/user/settings",
  },
];

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toStr(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isLikelyModelId(value: string): boolean {
  if (!value) return false;
  const id = value.trim();
  if (!id || id.length > 80) return false;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) return false;
  if (/^\d+$/.test(id)) return false;

  // Keep "default" because it's a valid Perplexity web model preference.
  if (id.toLowerCase() === "default") return true;

  // Prefer IDs that look like known model families.
  if (
    /(^|[-_.])(gpt|o[1345]|claude|sonar|gemini|deepseek|llama|mistral|qwen|grok|kimi|r1)/i.test(id)
  ) {
    return true;
  }

  // Generic fallback: model slugs are typically dashed.
  return id.includes("-");
}

function titleCaseModelId(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (s) => s.toUpperCase());
}

function addCandidate(map: Map<string, string>, idLike: unknown, nameLike?: unknown) {
  const id = toStr(idLike);
  if (!id) return;
  if (!isLikelyModelId(id)) return;

  const name = toStr(nameLike) || titleCaseModelId(id);
  if (!map.has(id)) map.set(id, name);
}

function collectFromArray(map: Map<string, string>, arr: unknown[]) {
  for (const item of arr) {
    if (typeof item === "string") {
      addCandidate(map, item, item);
      continue;
    }

    const rec = asRecord(item);
    addCandidate(
      map,
      rec.id ?? rec.model ?? rec.slug ?? rec.model_id ?? rec.modelId ?? rec.value ?? rec.name,
      rec.display_name ?? rec.displayName ?? rec.label ?? rec.title ?? rec.name
    );
  }
}

function parseModelsFromPayload(payload: unknown): PerplexityDiscoveredModel[] {
  const root = asRecord(payload);
  const out = new Map<string, string>();

  const candidates = [
    root.models,
    root.data,
    root.available_models,
    root.availableModels,
    root.model_preferences,
    root.modelPreferences,
    root.search_models,
    root.searchModels,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) collectFromArray(out, candidate);
    else if (candidate && typeof candidate === "object") {
      const rec = asRecord(candidate);
      for (const value of Object.values(rec)) {
        if (Array.isArray(value)) collectFromArray(out, value);
      }
    }
  }

  const settings = asRecord(root.settings);
  const defaultModel = toStr(settings.default_model ?? settings.defaultModel);
  if (defaultModel) addCandidate(out, defaultModel, defaultModel);

  // Some payloads are nested maps (model_id -> metadata) instead of arrays.
  // Traverse shallowly and collect id/name-like fields plus map keys.
  const visit = (value: unknown, depth = 0) => {
    if (depth > 5 || value == null) return;

    if (Array.isArray(value)) {
      collectFromArray(out, value);
      for (const item of value) visit(item, depth + 1);
      return;
    }

    if (typeof value !== "object") return;
    const rec = asRecord(value);
    addCandidate(
      out,
      rec.id ?? rec.model ?? rec.slug ?? rec.model_id ?? rec.modelId ?? rec.value ?? rec.name,
      rec.display_name ?? rec.displayName ?? rec.label ?? rec.title ?? rec.name
    );

    for (const [key, nested] of Object.entries(rec)) {
      if (/model/i.test(key)) {
        addCandidate(out, key, key);
      }
      visit(nested, depth + 1);
    }
  };

  visit(root);

  return Array.from(out.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function looksLikeCloudflareChallenge(body: string): boolean {
  const s = body.toLowerCase();
  return s.includes("just a moment") || s.includes("cf-challenge") || s.includes("cloudflare");
}

function parseCookiePairs(cookieString: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const segment of cookieString.split(";")) {
    const pair = segment.trim();
    if (!pair) continue;
    const eqIdx = pair.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (!name || !value) continue;
    out.set(name, value);
  }
  return out;
}

function collectModelStringsFromUnknown(value: unknown, out: Set<string>, depth = 0) {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    const s = value.trim();
    if (s.length > 0 && /^[a-z0-9._-]+$/i.test(s) && s.length <= 80) {
      out.add(s);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectModelStringsFromUnknown(item, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as JsonRecord)) {
      collectModelStringsFromUnknown(item, out, depth + 1);
    }
  }
}

function parseModelsFromCookieState(cookieString: string): PerplexityDiscoveredModel[] {
  const pairs = parseCookiePairs(cookieString);
  const raw =
    pairs.get("pplx.search-models-v4") ||
    pairs.get("search-models-v4") ||
    pairs.get("pplx.search-models");
  if (!raw) return [];

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep raw value.
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return [];
  }

  const modelIds = new Set<string>();
  collectModelStringsFromUnknown(parsed, modelIds);

  const ignored = new Set([
    "default",
    "thinking",
    "all",
    "auto",
    "on",
    "off",
    "true",
    "false",
    "home",
  ]);

  return Array.from(modelIds)
    .filter((id) => !ignored.has(id.toLowerCase()))
    .map((id) => ({ id, name: titleCaseModelId(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getPerplexityWeb2ApiFallbackModels(): PerplexityDiscoveredModel[] {
  return [
    { id: "default", name: "Perplexity Default" },
    { id: "gpt-4o", name: "GPT-4o (via Web, mapped)" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.5", name: "GPT-4.5" },
    { id: "gpt-5", name: "GPT-5" },
    { id: "o4-mini", name: "o4-mini" },
    { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "claude-3.7-sonnet", name: "Claude 3.7 Sonnet" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-opus-4.1", name: "Claude Opus 4.1" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "deepseek-r1", name: "DeepSeek R1" },
    { id: "sonar", name: "Sonar" },
    { id: "sonar-pro", name: "Sonar Pro" },
    { id: "sonar-reasoning", name: "Sonar Reasoning" },
    { id: "sonar-reasoning-pro", name: "Sonar Reasoning Pro" },
    { id: "sonar-deep-research", name: "Sonar Deep Research" },
    { id: "grok-3", name: "Grok 3" },
  ];
}

export async function discoverPerplexityWebModels(
  cookieString: string,
  fetchImpl: typeof fetch = fetch
): Promise<PerplexityModelDiscoveryResult> {
  const token = typeof cookieString === "string" ? cookieString.trim() : "";
  if (!token) {
    return {
      models: getPerplexityWeb2ApiFallbackModels(),
      source: "fallback_static",
      confidence: "low",
      warning: "No Perplexity cookie/session token configured.",
    };
  }

  for (const endpoint of DISCOVERY_ENDPOINTS) {
    try {
      const res = await fetchImpl(endpoint.url, {
        method: "GET",
        headers: {
          ...PERPLEXITY_WEB_HEADERS,
          Cookie: token,
        },
        signal: AbortSignal.timeout(12_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 403 && looksLikeCloudflareChallenge(text)) {
          continue;
        }
        continue;
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text().catch(() => "");
        if (looksLikeCloudflareChallenge(text)) continue;
      }

      const payload = await res.json().catch(() => null);
      const models = parseModelsFromPayload(payload);

      if (models.length > 0) {
        return {
          models,
          source: endpoint.source,
          confidence: endpoint.source === "web_catalog" ? "high" : "medium",
        };
      }
    } catch {
      // Continue trying next endpoint.
    }
  }

  const cookieModels = parseModelsFromCookieState(token);
  if (cookieModels.length > 0) {
    return {
      models: cookieModels,
      source: "web_settings",
      confidence: "medium",
      warning:
        "Perplexity web endpoints unavailable; model list inferred from browser cookie state.",
    };
  }

  return {
    models: getPerplexityWeb2ApiFallbackModels(),
    source: "fallback_static",
    confidence: "low",
    warning:
      "Perplexity Web model discovery endpoint unavailable or blocked (Cloudflare). Using fallback model list.",
  };
}
