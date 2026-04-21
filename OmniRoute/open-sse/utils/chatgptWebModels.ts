import { CHATGPT_WEB_HEADERS } from "./chatgptSession.ts";

type JsonRecord = Record<string, unknown>;

export type ChatgptDiscoveredModel = {
  id: string;
  name: string;
  contextLength?: number;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  maxContextLength?: number;
  truncationByteLimit?: number;
  availableInPlans?: string[];
  description?: string;
};

export type ChatgptModelDiscoveryResult = {
  models: ChatgptDiscoveredModel[];
  source: "codex_models" | "fallback_static";
  confidence: "high" | "low";
  warning?: string;
};

const CHATGPT_CODEX_MODELS_URL =
  "https://chatgpt.com/backend-api/codex/models?client_version=0.92.0";

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toPositiveIntegerOrNull(value: unknown): number | null {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return Math.floor(numberValue);
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => toStringOrNull(item))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? Array.from(new Set(items)) : null;
}

function titleCaseModelId(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (s) => s.toUpperCase());
}

function parseModelsFromPayload(payload: unknown): ChatgptDiscoveredModel[] {
  const root = asRecord(payload);
  const models = Array.isArray(root.models)
    ? root.models
    : Array.isArray(root.data)
      ? root.data
      : [];
  const out = new Map<string, ChatgptDiscoveredModel>();

  for (const item of models) {
    const record = asRecord(item);
    const id =
      toStringOrNull(record.model_slug) ||
      toStringOrNull(record.id) ||
      toStringOrNull(record.slug) ||
      toStringOrNull(record.model) ||
      toStringOrNull(record.modelId);
    if (!id) continue;
    if (!/^[a-z0-9][a-z0-9._-]{1,100}$/i.test(id)) continue;

    const name =
      toStringOrNull(record.display_name) ||
      toStringOrNull(record.displayName) ||
      toStringOrNull(record.name) ||
      titleCaseModelId(id);
    const contextLength =
      toPositiveIntegerOrNull(record.context_window) ||
      toPositiveIntegerOrNull(record.contextWindow) ||
      toPositiveIntegerOrNull(record.input_token_limit) ||
      toPositiveIntegerOrNull(record.inputTokenLimit);
    const outputTokenLimit =
      toPositiveIntegerOrNull(record.output_token_limit) ||
      toPositiveIntegerOrNull(record.outputTokenLimit) ||
      toPositiveIntegerOrNull(record.max_output_tokens) ||
      toPositiveIntegerOrNull(record.maxOutputTokens);
    const maxContextLength =
      toPositiveIntegerOrNull(record.max_context_window) ||
      toPositiveIntegerOrNull(record.maxContextWindow) ||
      contextLength;
    const truncationPolicy = asRecord(record.truncation_policy || record.truncationPolicy);
    const truncationByteLimit =
      toPositiveIntegerOrNull(truncationPolicy.limit) ||
      toPositiveIntegerOrNull(record.truncation_limit) ||
      toPositiveIntegerOrNull(record.truncationLimit);
    const availableInPlans =
      toStringArray(record.available_in_plans) || toStringArray(record.availableInPlans);
    const description = toStringOrNull(record.description);

    const model: ChatgptDiscoveredModel = { id, name };
    if (contextLength) {
      model.contextLength = contextLength;
      model.inputTokenLimit = contextLength;
    }
    if (outputTokenLimit) model.outputTokenLimit = outputTokenLimit;
    if (maxContextLength) model.maxContextLength = maxContextLength;
    if (truncationByteLimit) model.truncationByteLimit = truncationByteLimit;
    if (availableInPlans) model.availableInPlans = availableInPlans;
    if (description) model.description = description;

    if (!out.has(id)) out.set(id, model);
  }

  return Array.from(out.values());
}

export function getChatgptWeb2ApiFallbackModels(): ChatgptDiscoveredModel[] {
  return [
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max" },
    { id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
    { id: "gpt-5.1", name: "GPT-5.1" },
    { id: "gpt-5-codex", name: "GPT-5 Codex" },
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
    { id: "gpt-5-codex-mini", name: "GPT-5 Codex Mini" },
  ];
}

export async function discoverChatgptWebModels(
  credentials: {
    accessToken?: string | null;
    cookieString?: string | null;
  },
  fetchImpl: typeof fetch = fetch
): Promise<ChatgptModelDiscoveryResult> {
  const accessToken = toStringOrNull(credentials?.accessToken);
  if (!accessToken) {
    return {
      models: getChatgptWeb2ApiFallbackModels(),
      source: "fallback_static",
      confidence: "low",
      warning: "No ChatGPT access token configured.",
    };
  }

  try {
    const headers: Record<string, string> = {
      ...CHATGPT_WEB_HEADERS,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    const cookieString = toStringOrNull(credentials?.cookieString);
    if (cookieString) {
      headers.Cookie = cookieString;
    }

    const response = await fetchImpl(CHATGPT_CODEX_MODELS_URL, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      return {
        models: getChatgptWeb2ApiFallbackModels(),
        source: "fallback_static",
        confidence: "low",
        warning: `ChatGPT codex model discovery failed with ${response.status}. Using fallback list.`,
      };
    }

    const payload = await response.json().catch(() => null);
    const models = parseModelsFromPayload(payload);
    if (models.length > 0) {
      return {
        models,
        source: "codex_models",
        confidence: "high",
      };
    }
  } catch {
    // fall through to fallback
  }

  return {
    models: getChatgptWeb2ApiFallbackModels(),
    source: "fallback_static",
    confidence: "low",
    warning: "ChatGPT codex model discovery unavailable. Using fallback model list.",
  };
}
