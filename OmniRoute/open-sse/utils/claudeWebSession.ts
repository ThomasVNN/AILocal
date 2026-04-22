import { randomUUID } from "crypto";

export const CLAUDE_WEB_BASE_URL = "https://claude.ai";
export const CLAUDE_WEB_DEFAULT_MODEL = "claude-sonnet-4-6";

type JsonRecord = Record<string, unknown>;

type HeaderMap = Record<string, string>;

type CookieNormalizationOptions = {
  allowBareSessionToken?: boolean;
  organizationUuid?: string | null;
  requestHeaders?: HeaderMap | null;
};

type ClaudeWebSessionInputResult =
  | {
      valid: true;
      cookieString: string;
      cookieNames: string[];
      organizationUuid: string;
      requestHeaders: HeaderMap;
    }
  | {
      valid: false;
      errorCode: string;
      error: string;
      cookieNames: string[];
    };

type ClaudeWebValidationOptions = CookieNormalizationOptions & {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

type ClaudeWebValidationResult =
  | {
      valid: true;
      statusCode: number;
      cookieString: string;
      cookieNames: string[];
      organizationUuid: string;
      requestHeaders: HeaderMap;
    }
  | {
      valid: false;
      statusCode: number | null;
      errorCode: string;
      error: string;
      cookieNames: string[];
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLAUDE_WEB_ALLOWED_HEADER_NAMES = new Set([
  "accept-language",
  "anthropic-anonymous-id",
  "anthropic-beta",
  "anthropic-client-app",
  "anthropic-client-feature",
  "anthropic-client-os-platform",
  "anthropic-client-os-version",
  "anthropic-client-platform",
  "anthropic-client-sha",
  "anthropic-client-version",
  "anthropic-desktop-topbar",
  "anthropic-device-id",
  "anthropic-version",
  "priority",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "traceparent",
  "tracestate",
  "user-agent",
  "x-activity-session-id",
  "x-datadog-origin",
  "x-datadog-parent-id",
  "x-datadog-sampling-priority",
  "x-datadog-trace-id",
]);

const CLAUDE_WEB_DEFAULT_REQUEST_HEADERS: HeaderMap = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.3561.0 Chrome/146.0.0.0 Electron/41.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "anthropic-client-app": "com.anthropic.claudefordesktop",
  "anthropic-client-platform": "desktop_app",
  "anthropic-client-os-platform": "darwin",
  "anthropic-client-version": "1.3561.0",
  "anthropic-desktop-topbar": "1",
  "anthropic-version": "2023-06-01",
  Origin: CLAUDE_WEB_BASE_URL,
  Referer: `${CLAUDE_WEB_BASE_URL}/new`,
};

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function lowerHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function canonicalHeaderName(name: string): string {
  const lower = lowerHeaderName(name);
  switch (lower) {
    case "accept-language":
      return "Accept-Language";
    case "content-type":
      return "Content-Type";
    case "origin":
      return "Origin";
    case "referer":
      return "Referer";
    case "user-agent":
      return "User-Agent";
    case "sec-ch-ua":
      return "sec-ch-ua";
    case "sec-ch-ua-mobile":
      return "sec-ch-ua-mobile";
    case "sec-ch-ua-platform":
      return "sec-ch-ua-platform";
    case "sec-fetch-dest":
      return "sec-fetch-dest";
    case "sec-fetch-mode":
      return "sec-fetch-mode";
    case "sec-fetch-site":
      return "sec-fetch-site";
    default:
      return lower;
  }
}

function parseCookiePairs(cookieString: string) {
  const cookies = new Map<string, string>();
  const cookieNames: string[] = [];

  for (const segment of cookieString.split(";")) {
    const pair = segment.trim();
    if (!pair) continue;
    const eqIdx = pair.indexOf("=");
    if (eqIdx <= 0) continue;

    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (!name || !value) continue;

    if (!cookies.has(name)) cookieNames.push(name);
    cookies.set(name, value);
  }

  return { cookies, cookieNames };
}

function formatCookieMap(cookies: Map<string, string>) {
  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function extractCookieEntriesFromJson(raw: string): Array<{ name: string; value: string }> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    const root = toRecord(parsed);
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(root.cookies)
        ? root.cookies
        : Array.isArray(root.items)
          ? root.items
          : [];

    if (!Array.isArray(entries) || entries.length === 0) return null;

    const normalized: Array<{ name: string; value: string }> = [];
    for (const entry of entries) {
      const cookie = toRecord(entry);
      const name = toNullableString(cookie.name) || toNullableString(cookie.key);
      const value = toNullableString(cookie.value) || toNullableString(cookie.cookieValue);
      if (!name || !value) continue;
      normalized.push({ name, value });
    }

    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function getCookieValue(cookies: Map<string, string>, name: string): string | null {
  return cookies.get(name) || null;
}

function parseCapturedHeaders(raw: string) {
  const headerValues = new Map<string, string[]>();
  const cookieValues: string[] = [];
  const requestHeaders: HeaderMap = {};

  const addHeader = (name: string, value: string) => {
    const normalizedName = lowerHeaderName(name.replace(/^:/, ""));
    const normalizedValue = value.trim();
    if (!normalizedName || !normalizedValue) return;

    if (normalizedName === "cookie") {
      cookieValues.push(normalizedValue);
      return;
    }

    const current = headerValues.get(normalizedName) || [];
    current.push(normalizedValue);
    headerValues.set(normalizedName, current);

    if (CLAUDE_WEB_ALLOWED_HEADER_NAMES.has(normalizedName)) {
      requestHeaders[canonicalHeaderName(normalizedName)] = normalizedValue;
    }
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const curlHeaderMatches = line.matchAll(/(?:-H|--header)\s+\$?(?:"([^"]+)"|'([^']+)')/g);
    for (const match of curlHeaderMatches) {
      const headerLine = match[1] || match[2] || "";
      const idx = headerLine.indexOf(":");
      if (idx > 0) {
        addHeader(headerLine.slice(0, idx), headerLine.slice(idx + 1));
      }
    }

    const curlCookieMatches = line.matchAll(/(?:-b|--cookie)\s+\$?(?:"([^"]+)"|'([^']+)')/g);
    for (const match of curlCookieMatches) {
      const cookieLine = (match[1] || match[2] || "").trim();
      if (cookieLine) cookieValues.push(cookieLine);
    }

    const headerMatch = /^(:?[A-Za-z0-9][A-Za-z0-9_.-]*)\s*:\s*([\s\S]+)$/.exec(line);
    if (headerMatch) {
      addHeader(headerMatch[1], headerMatch[2]);
    }
  }

  return { headerValues, cookieValues, requestHeaders };
}

function firstHeaderValue(headerValues: Map<string, string[]>, name: string): string | null {
  const values = headerValues.get(lowerHeaderName(name));
  return values?.find((value) => value.trim().length > 0)?.trim() || null;
}

function extractOrganizationUuid(
  raw: string,
  cookies: Map<string, string>,
  options: CookieNormalizationOptions,
  headerValues: Map<string, string[]>
): string | null {
  const configured = toNullableString(options.organizationUuid);
  if (configured && UUID_RE.test(configured)) return configured;

  const headerOrg = firstHeaderValue(headerValues, "x-organization-uuid");
  if (headerOrg && UUID_RE.test(headerOrg)) return headerOrg;

  const cookieOrg = getCookieValue(cookies, "lastActiveOrg");
  if (cookieOrg && UUID_RE.test(cookieOrg)) return cookieOrg;

  const pathMatch = /\/organizations\/([0-9a-f-]{36})(?:\/|$)/i.exec(raw);
  if (pathMatch?.[1] && UUID_RE.test(pathMatch[1])) return pathMatch[1];

  return null;
}

function normalizeRequestHeaders(
  parsedHeaders: HeaderMap,
  options: CookieNormalizationOptions,
  cookies: Map<string, string>
): HeaderMap {
  const merged: HeaderMap = { ...parsedHeaders };
  const configuredHeaders = options.requestHeaders || {};
  for (const [name, value] of Object.entries(configuredHeaders)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const normalizedName = lowerHeaderName(name);
    if (!CLAUDE_WEB_ALLOWED_HEADER_NAMES.has(normalizedName)) continue;
    merged[canonicalHeaderName(normalizedName)] = value.trim();
  }

  const deviceIdCookie = getCookieValue(cookies, "anthropic-device-id");
  if (deviceIdCookie && !merged["anthropic-device-id"]) {
    merged["anthropic-device-id"] = deviceIdCookie;
  }

  return merged;
}

export function normalizeClaudeWebSessionInput(
  rawSessionInput: unknown,
  options: CookieNormalizationOptions = {}
): ClaudeWebSessionInputResult {
  const raw = typeof rawSessionInput === "string" ? rawSessionInput.trim() : "";
  if (!raw) {
    return {
      valid: false,
      errorCode: "missing_session_input",
      error: "Claude Web session input is required",
      cookieNames: [],
    };
  }

  const parsedHeaders = parseCapturedHeaders(raw);
  const jsonCookieEntries = extractCookieEntriesFromJson(raw);
  const cookieSources =
    parsedHeaders.cookieValues.length > 0
      ? parsedHeaders.cookieValues
      : jsonCookieEntries
        ? jsonCookieEntries.map((entry) => `${entry.name}=${entry.value}`)
        : [raw.replace(/^cookie\s*:\s*/i, "").trim()];

  const joinedCookies = cookieSources.join("; ");

  if (!joinedCookies.includes("=")) {
    if (options.allowBareSessionToken) {
      const cookies = new Map([["sessionKey", joinedCookies]]);
      const organizationUuid = extractOrganizationUuid(
        raw,
        cookies,
        options,
        parsedHeaders.headerValues
      );
      if (!organizationUuid) {
        return {
          valid: false,
          errorCode: "missing_organization_uuid",
          error:
            "Claude Web session requires an organization UUID. Paste a full claude.ai request capture or include lastActiveOrg.",
          cookieNames: ["sessionKey"],
        };
      }
      return {
        valid: true,
        cookieString: formatCookieMap(cookies),
        cookieNames: ["sessionKey"],
        organizationUuid,
        requestHeaders: normalizeRequestHeaders(parsedHeaders.requestHeaders, options, cookies),
      };
    }

    return {
      valid: false,
      errorCode: "invalid_cookie_format",
      error:
        "Invalid Claude Web session input. Paste a full request header capture, Copy as cURL, Cookie header, or JSON cookie export.",
      cookieNames: [],
    };
  }

  const { cookies, cookieNames } = parseCookiePairs(joinedCookies);
  if (cookies.size === 0) {
    return {
      valid: false,
      errorCode: "invalid_cookie_format",
      error:
        "Invalid Claude Web session input. Paste a full request header capture, Copy as cURL, Cookie header, or JSON cookie export.",
      cookieNames: [],
    };
  }

  if (!cookies.has("sessionKey")) {
    return {
      valid: false,
      errorCode: "missing_session_key",
      error: "Claude Web session cookie must include sessionKey",
      cookieNames,
    };
  }

  const organizationUuid = extractOrganizationUuid(
    raw,
    cookies,
    options,
    parsedHeaders.headerValues
  );
  if (!organizationUuid) {
    return {
      valid: false,
      errorCode: "missing_organization_uuid",
      error:
        "Claude Web session requires an organization UUID. Paste a full claude.ai request capture or include lastActiveOrg.",
      cookieNames,
    };
  }

  return {
    valid: true,
    cookieString: formatCookieMap(cookies),
    cookieNames,
    organizationUuid,
    requestHeaders: normalizeRequestHeaders(parsedHeaders.requestHeaders, options, cookies),
  };
}

export function normalizeClaudeWebModel(model: unknown): string {
  if (typeof model !== "string" || model.trim().length === 0) return CLAUDE_WEB_DEFAULT_MODEL;
  let normalized = model.trim();
  for (const prefix of ["claudew2a/", "claude-w2a/"]) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }
  return normalized || CLAUDE_WEB_DEFAULT_MODEL;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      const record = toRecord(part);
      if (typeof record.text === "string") return record.text;
      if (record.type === "input_text" && typeof record.text === "string") return record.text;
      if (record.type === "tool_result") {
        const rawContent = record.content;
        const resultText =
          typeof rawContent === "string"
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent.map(extractTextFromContent).filter(Boolean).join("\n")
              : JSON.stringify(rawContent ?? "");
        return `[Tool result: ${toString(record.tool_use_id, "tool")}]\n${resultText}`;
      }
      if (record.type === "tool_use") {
        return `[Tool call: ${toString(record.name, "tool")}]\n${JSON.stringify(record.input ?? {})}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractResponsesInputText(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (Array.isArray(input)) {
    return input.map(extractResponsesInputText).filter(Boolean).join("\n\n").trim();
  }

  const item = toRecord(input);
  if (typeof item.text === "string") return item.text.trim();
  if (Array.isArray(item.content)) return extractTextFromContent(item.content);
  return "";
}

function roleLabel(role: string): string {
  switch (role) {
    case "system":
      return "System";
    case "developer":
      return "Developer";
    case "assistant":
      return "Assistant";
    case "tool":
      return "Tool";
    default:
      return "User";
  }
}

function collectSystemText(body: JsonRecord): string[] {
  const systemParts: string[] = [];
  if (typeof body.system === "string" && body.system.trim()) {
    systemParts.push(body.system.trim());
  } else if (Array.isArray(body.system)) {
    const text = extractTextFromContent(body.system);
    if (text) systemParts.push(text);
  }
  return systemParts;
}

export function buildClaudeWebPrompt(body: JsonRecord): string {
  if (typeof body.prompt === "string" && body.prompt.trim()) return body.prompt.trim();

  const systemParts = collectSystemText(body);
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];

  if (rawMessages.length === 0) {
    return extractResponsesInputText(body.input);
  }

  const normalizedMessages = rawMessages
    .map((value) => {
      const message = toRecord(value);
      const role = toString(message.role, "user").trim().toLowerCase();
      const text = extractTextFromContent(message.content);
      return { role, text };
    })
    .filter((message) => message.text.length > 0);

  const inlineSystem = normalizedMessages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => message.text);
  systemParts.push(...inlineSystem);

  const conversation = normalizedMessages.filter(
    (message) => message.role !== "system" && message.role !== "developer"
  );

  if (systemParts.length === 0 && conversation.length === 1 && conversation[0].role === "user") {
    return conversation[0].text;
  }

  let currentUserRequest = "";
  if (conversation.length > 0 && conversation[conversation.length - 1].role === "user") {
    currentUserRequest = conversation[conversation.length - 1].text;
    conversation.pop();
  }

  const sections: string[] = [];
  if (systemParts.length > 0) {
    sections.push(`System instructions:\n${systemParts.join("\n\n")}`);
  }
  if (conversation.length > 0) {
    sections.push(
      `Conversation history:\n${conversation
        .map((message) => `${roleLabel(message.role)}: ${message.text}`)
        .join("\n\n")}`
    );
  }
  if (currentUserRequest) {
    sections.push(`Current user request:\n${currentUserRequest}`);
  }

  return sections.join("\n\n").trim();
}

export function buildClaudeWebCompletionPayload({
  model,
  body,
  conversationUuid,
  timezone,
  locale,
  temporary,
}: {
  model: unknown;
  body: JsonRecord;
  conversationUuid?: string | null;
  timezone?: string | null;
  locale?: string | null;
  temporary?: boolean | null;
}): JsonRecord {
  const normalizedModel = normalizeClaudeWebModel(model || body.model);
  const prompt = buildClaudeWebPrompt(body);

  if (!prompt) {
    const error = new Error("Claude Web2API requires a non-empty prompt") as Error & {
      statusCode: number;
      errorType: string;
    };
    error.statusCode = 400;
    error.errorType = "invalid_request_error";
    throw error;
  }

  return {
    prompt,
    timezone: timezone || process.env.TZ || "UTC",
    personalized_styles: [
      {
        type: "default",
        key: "Default",
        name: "Normal",
        nameKey: "normal_style_name",
        prompt: "Normal\n",
        summary: "Default responses from Claude",
        summaryKey: "normal_style_summary",
        isDefault: true,
      },
    ],
    locale: locale || "en-US",
    model: normalizedModel,
    tools: [],
    turn_message_uuids: {
      human_message_uuid: randomUUID(),
      assistant_message_uuid: randomUUID(),
    },
    attachments: [],
    files: [],
    sync_sources: [],
    rendering_mode: "messages",
    create_conversation_params: {
      name: "",
      model: normalizedModel,
      include_conversation_preferences: true,
      paprika_mode: "extended",
      compass_mode: null,
      is_temporary: temporary === true,
      enabled_imagine: true,
    },
    ...(conversationUuid ? { conversation_uuid: conversationUuid } : {}),
  };
}

export function buildClaudeWebRequestHeaders({
  cookieString,
  organizationUuid,
  requestHeaders = {},
  accept = "text/event-stream",
}: {
  cookieString: string;
  organizationUuid: string;
  requestHeaders?: HeaderMap;
  accept?: string;
}): HeaderMap {
  const headers: HeaderMap = {
    ...CLAUDE_WEB_DEFAULT_REQUEST_HEADERS,
    ...requestHeaders,
    Accept: accept,
    "Content-Type": "application/json",
    Cookie: cookieString,
    "x-organization-uuid": organizationUuid,
  };

  delete headers["accept-encoding"];
  delete headers["Accept-Encoding"];
  delete headers.Authorization;
  delete headers.authorization;
  return headers;
}

function buildClaudeWebSessionError(statusCode: number | null, responseBody: string) {
  const body = responseBody.toLowerCase();
  if (statusCode === 401) {
    return {
      errorCode: "session_expired",
      error: "Claude Web session expired or invalid. Reconnect with fresh claude.ai cookies.",
    };
  }
  if (statusCode === 403) {
    if (body.includes("cloudflare") || body.includes("cf_chl") || body.includes("challenge")) {
      return {
        errorCode: "cloudflare_blocked",
        error:
          "Cloudflare blocked the Claude Web request. Paste the full request capture including cf_clearance.",
      };
    }
    return {
      errorCode: "session_forbidden",
      error: "Claude Web session is forbidden. Reconnect with fresh claude.ai cookies.",
    };
  }
  if (statusCode === 404) {
    return {
      errorCode: "organization_not_found",
      error: "Claude organization was not found. Paste a capture from the active Claude account.",
    };
  }
  if (statusCode && statusCode >= 500) {
    return {
      errorCode: "upstream_unavailable",
      error: `Validation failed: ${statusCode}`,
    };
  }
  return {
    errorCode: "session_invalid",
    error: statusCode
      ? `Claude Web session check returned ${statusCode}`
      : "Session validation failed",
  };
}

export async function validateClaudeWebSession(
  rawSessionInput: unknown,
  options: ClaudeWebValidationOptions = {}
): Promise<ClaudeWebValidationResult> {
  const normalized = normalizeClaudeWebSessionInput(rawSessionInput, options);
  if (!normalized.valid) {
    return {
      valid: false,
      statusCode: null,
      errorCode: normalized.errorCode,
      error: normalized.error,
      cookieNames: normalized.cookieNames,
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const url = `${CLAUDE_WEB_BASE_URL}/v1/environment_providers/private/organizations/${normalized.organizationUuid}/environments`;
  const headers = buildClaudeWebRequestHeaders({
    cookieString: normalized.cookieString,
    organizationUuid: normalized.organizationUuid,
    requestHeaders: normalized.requestHeaders,
    accept: "application/json",
  });

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: options.signal,
    });

    if (response.ok) {
      return {
        valid: true,
        statusCode: response.status,
        cookieString: normalized.cookieString,
        cookieNames: normalized.cookieNames,
        organizationUuid: normalized.organizationUuid,
        requestHeaders: normalized.requestHeaders,
      };
    }

    const responseBody = await response.text().catch(() => "");
    const error = buildClaudeWebSessionError(response.status, responseBody);
    return {
      valid: false,
      statusCode: response.status,
      cookieNames: normalized.cookieNames,
      ...error,
    };
  } catch (error) {
    return {
      valid: false,
      statusCode: null,
      errorCode: "network_error",
      error: error instanceof Error ? error.message : "Claude Web validation failed",
      cookieNames: normalized.cookieNames,
    };
  }
}

export function buildClaudeWebSessionProviderData(
  existing: JsonRecord | null | undefined,
  update: {
    sessionStatus: string;
    organizationUuid?: string | null;
    cookieNames?: string[] | null;
    requestHeaders?: HeaderMap | null;
    importedAt?: string | null;
    validatedAt?: string | null;
    refreshedAt?: string | null;
    sessionSource?: string | null;
    error?: string | null;
  }
): JsonRecord {
  const current = toRecord(existing);
  return {
    ...current,
    authMethod: "web2api",
    sessionStatus: update.sessionStatus,
    ...(update.organizationUuid ? { organizationUuid: update.organizationUuid } : {}),
    ...(update.cookieNames ? { cookieNames: update.cookieNames } : {}),
    ...(update.requestHeaders ? { requestHeaders: update.requestHeaders } : {}),
    ...(update.importedAt ? { importedAt: update.importedAt } : {}),
    ...(update.validatedAt ? { lastValidatedAt: update.validatedAt } : {}),
    ...(update.refreshedAt ? { refreshedAt: update.refreshedAt } : {}),
    ...(update.sessionSource ? { sessionSource: update.sessionSource } : {}),
    lastSessionError: update.error || null,
  };
}
