import { createHash } from "node:crypto";

const GEMINI_WEB_MODELS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
const GEMINI_WEB_VALIDATE_MODEL = "gemini-2.5-flash";
const GEMINI_WEB_VALIDATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_WEB_VALIDATE_MODEL}:generateContent`;
const GEMINI_WEB_FALLBACK_MODELS = [
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
  { id: "gemini-3.1-flash", name: "Gemini 3.1 Flash" },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
];

const GEMINI_WEB_DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  Origin: "https://gemini.google.com",
  Referer: "https://gemini.google.com/",
};

type GeminiWebSessionUser = {
  id: string | null;
  email: string | null;
  name: string | null;
};

type GeminiSessionNormalizationResult =
  | {
      valid: true;
      authorization: string | null;
      requestHeaders: Record<string, string>;
      normalizedInput: string;
    }
  | {
      valid: false;
      errorCode: string;
      error: string;
    };

type GeminiWebSessionValidationResult =
  | {
      valid: true;
      statusCode: number;
      accessToken: string;
      authMode: "authorization";
      apiKey: string | null;
      authorizationHeader: string | null;
      requestHeaders: Record<string, string>;
      session: GeminiWebSessionUser;
      models: Array<{ id: string; name: string }>;
      raw: Record<string, unknown>;
    }
  | {
      valid: false;
      statusCode: number | null;
      errorCode: string;
      error: string;
      requestHeaders: Record<string, string>;
    };

type GeminiWebSessionValidationOptions = {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

const HEADER_NAME_RE = /^:?[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const GEMINI_API_KEY_RE = /^AIza[0-9A-Za-z_-]{8,}$/;
const SECRET_REF_RE = /^secretref-[0-9A-Za-z_-]{4,}$/i;
const BEARER_HEADER_RE = /^bearer\s+.+$/i;
const SAPISID_HASH_RE = /^sapisidhash\s+.+$/i;

const FORWARDED_HEADER_CASE_MAP: Record<string, string> = {
  accept: "Accept",
  "accept-language": "Accept-Language",
  cookie: "Cookie",
  origin: "Origin",
  referer: "Referer",
  "user-agent": "User-Agent",
  "x-client-data": "x-client-data",
  "x-goog-authuser": "x-goog-authuser",
  "x-user-agent": "x-user-agent",
};

function resolveForwardedHeaderName(rawName: string): string | null {
  const name = normalizeHeaderName(rawName);
  const mapped = FORWARDED_HEADER_CASE_MAP[name];
  if (mapped) return mapped;
  if (/^x-goog-ext-[0-9a-z-]+$/i.test(name)) return name;
  if (name === "x-same-domain") return name;
  if (name === "priority") return name;
  if (/^sec-ch-ua(?:-[0-9a-z-]+)?$/i.test(name)) return name;
  if (/^sec-fetch-(?:dest|mode|site|user)$/i.test(name)) return name;
  return null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function looksLikeHeaderName(line: string): boolean {
  return HEADER_NAME_RE.test(line.trim());
}

function looksLikeCredentialValue(line: string): boolean {
  const value = line.trim();
  if (!value) return false;
  return (
    GEMINI_API_KEY_RE.test(value) ||
    SECRET_REF_RE.test(value) ||
    BEARER_HEADER_RE.test(value) ||
    SAPISID_HASH_RE.test(value)
  );
}

export function looksLikeGeminiApiKey(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return GEMINI_API_KEY_RE.test(trimmed) || SECRET_REF_RE.test(trimmed);
}

function maybeExtractBearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = /^bearer\s+(.+)$/i.exec(value);
  if (match && match[1]) {
    return match[1].trim() || null;
  }
  return null;
}

function normalizePossiblyPrefixedHeaderLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";

  const numberedMatch = /^(\d+)\s*:\s*(.+)$/.exec(trimmed);
  if (numberedMatch?.[2] && /^:?[A-Za-z0-9][A-Za-z0-9_.-]*\s*[:\t ]/.test(numberedMatch[2])) {
    return numberedMatch[2].trim();
  }

  return trimmed;
}

function appendParsedHeader(
  headers: Record<string, string>,
  headerName: string,
  headerValue: string
): void {
  const normalizedName = normalizeHeaderName(headerName);
  const normalizedValue = headerValue.trim();
  if (!normalizedName || !normalizedValue) return;

  if (normalizedName === "cookie" && headers[normalizedName]) {
    headers[normalizedName] = `${headers[normalizedName]}; ${normalizedValue}`;
    return;
  }

  headers[normalizedName] = normalizedValue;
}

function normalizeHeaderValue(headerName: string, value: unknown): string | null {
  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => toNonEmptyString(item))
      .filter((item): item is string => item !== null);
    if (normalizedItems.length === 0) return null;
    return normalizeHeaderName(headerName) === "cookie"
      ? normalizedItems.join("; ")
      : normalizedItems.join(", ");
  }

  return toNonEmptyString(value);
}

function extractCookieHeaderFromCookieEntries(rawEntries: unknown): string | null {
  if (!Array.isArray(rawEntries)) return null;

  const cookiePairs = rawEntries
    .map((entry) => {
      const cookie = toRecord(entry);
      const name = toNonEmptyString(cookie.name);
      const value = toNonEmptyString(cookie.value);
      return name && value !== null ? `${name}=${value}` : null;
    })
    .filter((pair): pair is string => pair !== null);

  return cookiePairs.length > 0 ? cookiePairs.join("; ") : null;
}

function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const cookies = new Map<string, string>();
  const parts = cookieHeader.split(";");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex <= 0) continue;
    const name = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();
    if (!name || !value) continue;
    cookies.set(name, value);
  }

  return cookies;
}

function hashSapisidValue(
  hashLabel: "SAPISIDHASH" | "SAPISID1PHASH" | "SAPISID3PHASH",
  value: string,
  origin: string,
  timestampSec: number
): string {
  const digest = createHash("sha1").update(`${timestampSec} ${value} ${origin}`).digest("hex");
  return `${hashLabel} ${timestampSec}_${digest}`;
}

export function buildGeminiAuthorizationFromCookieHeader(
  cookieHeader: string | null | undefined,
  origin = "https://gemini.google.com",
  nowMs = Date.now()
): string | null {
  const normalizedCookie = toNonEmptyString(cookieHeader);
  if (!normalizedCookie) return null;

  const cookies = parseCookieHeader(normalizedCookie);
  const timestampSec = Math.floor(nowMs / 1000);
  const authParts: string[] = [];

  const sapisid = cookies.get("SAPISID") || cookies.get("APISID");
  if (sapisid) {
    authParts.push(hashSapisidValue("SAPISIDHASH", sapisid, origin, timestampSec));
  }

  const sapisid1p = cookies.get("__Secure-1PAPISID");
  if (sapisid1p) {
    authParts.push(hashSapisidValue("SAPISID1PHASH", sapisid1p, origin, timestampSec));
  }

  const sapisid3p = cookies.get("__Secure-3PAPISID");
  if (sapisid3p) {
    authParts.push(hashSapisidValue("SAPISID3PHASH", sapisid3p, origin, timestampSec));
  }

  return authParts.length > 0 ? authParts.join(" ") : null;
}

function parseHeaderLines(input: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = input
    .split(/\r?\n/)
    .map((line) => normalizePossiblyPrefixedHeaderLine(line))
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sameLineMatch = /^(:?[A-Za-z0-9][A-Za-z0-9_.-]*)\s*:\s*(.+)$/.exec(line);
    if (sameLineMatch) {
      appendParsedHeader(headers, sameLineMatch[1], sameLineMatch[2]);
      continue;
    }

    const whitespaceDelimitedMatch = /^(:?[A-Za-z0-9][A-Za-z0-9_.-]*)\s+(.+)$/.exec(line);
    if (whitespaceDelimitedMatch) {
      appendParsedHeader(headers, whitespaceDelimitedMatch[1], whitespaceDelimitedMatch[2]);
      continue;
    }

    if (!looksLikeHeaderName(line)) {
      continue;
    }

    const nextLine = lines[index + 1];
    if (!nextLine) {
      continue;
    }

    const nextLooksLikeHeader =
      looksLikeHeaderName(nextLine) ||
      /^(:?[A-Za-z0-9][A-Za-z0-9_.-]*)\s*:\s*(.+)$/.test(nextLine) ||
      /^(:?[A-Za-z0-9][A-Za-z0-9_.-]*)\s+(.+)$/.test(nextLine);

    const headerName = normalizeHeaderName(line);
    const nextLooksLikeCredential = looksLikeCredentialValue(nextLine);
    const requiresCredentialValue =
      headerName === "x-goog-api-key" ||
      headerName === "x-api-key" ||
      headerName === "authorization" ||
      headerName === "proxy-authorization";

    if (nextLooksLikeHeader && !(requiresCredentialValue && nextLooksLikeCredential)) {
      continue;
    }

    if (headerName) {
      appendParsedHeader(headers, headerName, nextLine);
    }
    index += 1;
  }

  return headers;
}

function decodeCurlQuotedValue(value: string): string {
  return value
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function extractHeadersFromCurlCommand(input: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const headerFlagRe =
    /(?:^|\s)(?:-H|--header)\s+\$?(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/gms;
  const cookieFlagRe =
    /(?:^|\s)(?:-b|--cookie)\s+\$?(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/gms;

  let match: RegExpExecArray | null;
  while ((match = headerFlagRe.exec(input))) {
    const rawValue = decodeCurlQuotedValue(match[1] ?? match[2] ?? "").trim();
    if (!rawValue) continue;
    const parsedHeader = /^([^:]+):\s*(.+)$/.exec(rawValue);
    if (!parsedHeader) continue;
    appendParsedHeader(headers, parsedHeader[1], parsedHeader[2]);
  }

  while ((match = cookieFlagRe.exec(input))) {
    const rawCookie = decodeCurlQuotedValue(match[1] ?? match[2] ?? "").trim();
    if (!rawCookie) continue;
    appendParsedHeader(headers, "cookie", rawCookie);
  }

  return headers;
}

function extractHeadersFromInput(rawInput: unknown): Record<string, string> {
  if (Array.isArray(rawInput)) {
    const cookieHeader = extractCookieHeaderFromCookieEntries(rawInput);
    return cookieHeader ? { cookie: cookieHeader } : {};
  }

  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!trimmed) return {};

    const parsedFromCurl = extractHeadersFromCurlCommand(trimmed);
    if (Object.keys(parsedFromCurl).length > 0) {
      return parsedFromCurl;
    }

    const parsedFromText = parseHeaderLines(trimmed);
    if (Object.keys(parsedFromText).length > 0) {
      return parsedFromText;
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return extractHeadersFromInput(parsed);
      } catch {
        return {};
      }
    }

    return {};
  }

  const record = toRecord(rawInput);
  const directHeaders = toRecord(record.headers);
  const requestHeaders = toRecord(record.requestHeaders);

  const headers: Record<string, string> = {};
  const append = (name: string, value: unknown) => {
    const normalizedName = normalizeHeaderName(name);
    const normalizedValue = normalizeHeaderValue(normalizedName, value);
    if (!normalizedName || !normalizedValue) return;
    appendParsedHeader(headers, normalizedName, normalizedValue);
  };

  for (const [name, value] of Object.entries(record)) {
    if (name === "headers" || name === "requestHeaders") continue;
    if (!looksLikeHeaderName(name)) continue;
    append(name, value);
  }

  for (const [name, value] of Object.entries(directHeaders)) {
    append(name, value);
  }

  for (const [name, value] of Object.entries(requestHeaders)) {
    append(name, value);
  }

  const cookiesField = record.cookies || record.cookieJar || record.cookieStore;
  const cookieHeader = extractCookieHeaderFromCookieEntries(cookiesField);
  if (cookieHeader) {
    append("cookie", cookieHeader);
  }

  return headers;
}

function normalizeForwardedHeaders(headers: Record<string, string>): Record<string, string> {
  const requestHeaders: Record<string, string> = {};

  for (const [rawName, rawValue] of Object.entries(headers)) {
    const canonicalName = resolveForwardedHeaderName(rawName);
    if (!canonicalName) continue;
    requestHeaders[canonicalName] = rawValue;
  }

  return requestHeaders;
}

function normalizeGeminiSessionInput(rawInput: unknown): GeminiSessionNormalizationResult {
  const headers = extractHeadersFromInput(rawInput);
  const recordInput = toRecord(rawInput);
  const stringInput = typeof rawInput === "string" ? rawInput.trim() : "";

  const apiKeyFromRecord =
    toNonEmptyString(recordInput.apiKey) ||
    toNonEmptyString(recordInput.key) ||
    toNonEmptyString(recordInput.geminiApiKey) ||
    null;

  const authorizationFromRecord =
    toNonEmptyString(recordInput.authorization) ||
    toNonEmptyString(recordInput.authHeader) ||
    toNonEmptyString(recordInput.authorizationHeader) ||
    null;

  const apiKeyFromHeaders =
    toNonEmptyString(headers["x-goog-api-key"]) || toNonEmptyString(headers["x-api-key"]) || null;

  const authorizationFromHeaders =
    toNonEmptyString(headers.authorization) ||
    toNonEmptyString(headers["proxy-authorization"]) ||
    null;

  const authorizationFromCookies = buildGeminiAuthorizationFromCookieHeader(headers.cookie);

  const apiKeyFromString = looksLikeGeminiApiKey(stringInput) ? stringInput : null;

  const authorizationFromString =
    BEARER_HEADER_RE.test(stringInput) || SAPISID_HASH_RE.test(stringInput) ? stringInput : null;

  const apiKey = apiKeyFromHeaders || apiKeyFromRecord || apiKeyFromString;
  const authorization =
    authorizationFromHeaders ||
    authorizationFromRecord ||
    authorizationFromString ||
    authorizationFromCookies;

  if (!authorization && apiKey) {
    return {
      valid: false,
      errorCode: "gemini_api_key_not_supported",
      error:
        "Gemini Web2API only accepts browser-derived authorization headers or cookies from gemini.google.com. Add Gemini API keys under the official Gemini (Google AI Studio) provider instead.",
    };
  }

  if (!authorization) {
    return {
      valid: false,
      errorCode: "missing_gemini_auth",
      error:
        "Missing Gemini web-session credentials. Paste browser request headers, a Copy as cURL capture, or Cookie data with SAPISID/APISID values from gemini.google.com.",
    };
  }

  const requestHeaders = normalizeForwardedHeaders(headers);

  return {
    valid: true,
    authorization,
    requestHeaders,
    normalizedInput:
      typeof rawInput === "string" ? rawInput : JSON.stringify({ headers, authorization }),
  };
}

function buildGeminiValidationError(statusCode: number | null): {
  errorCode: string;
  error: string;
} {
  if (statusCode === 400) {
    return {
      errorCode: "invalid_request",
      error:
        "Gemini rejected the web-session payload. Re-check Authorization or Cookie values captured from gemini.google.com.",
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      errorCode: "invalid_credentials",
      error: "Gemini web-session credentials are invalid or expired. Re-import fresh browser headers or cookies.",
    };
  }

  if (statusCode === 429) {
    return {
      errorCode: "rate_limited",
      error: "Gemini API is rate limited for this credential. Try again later.",
    };
  }

  if (statusCode && statusCode >= 500) {
    return {
      errorCode: "upstream_unavailable",
      error: `Gemini upstream unavailable (${statusCode}).`,
    };
  }

  return {
    errorCode: "session_invalid",
    error: statusCode ? `Gemini validation failed (${statusCode}).` : "Gemini validation failed.",
  };
}

function parseGeminiModels(payload: Record<string, unknown>): Array<{ id: string; name: string }> {
  const rawModels = Array.isArray(payload.models) ? payload.models : [];
  return rawModels
    .map((entry) => {
      const model = toRecord(entry);
      const rawName = toNonEmptyString(model.name) || toNonEmptyString(model.id) || "";
      const id = rawName.replace(/^models\//, "");
      if (!id) return null;
      return {
        id,
        name: toNonEmptyString(model.displayName) || id,
      };
    })
    .filter((entry): entry is { id: string; name: string } => entry !== null);
}

export function buildGeminiWebSessionProviderData(
  existing: Record<string, unknown> | null | undefined,
  update: {
    sessionStatus: string;
    authMode?: "x-goog-api-key" | "authorization";
    requestHeaders?: Record<string, string>;
    authorizationHeader?: string | null;
    error?: string | null;
    importedAt?: string | null;
    validatedAt?: string | null;
    refreshedAt?: string | null;
    sessionSource?: string;
    models?: Array<{ id: string; name: string }>;
  }
) {
  const current = existing && typeof existing === "object" ? existing : {};
  const currentModels = Array.isArray((current as Record<string, unknown>).models)
    ? ((current as Record<string, unknown>).models as Array<{ id: string; name: string }>)
    : [];
  const importedAt =
    update.importedAt || toNonEmptyString(current.importedAt) || update.validatedAt || null;

  return {
    ...current,
    authMethod: "web2api",
    sessionSource:
      update.sessionSource || toNonEmptyString(current.sessionSource) || "browser_request_headers",
    sessionStatus: update.sessionStatus,
    authMode: update.authMode || toNonEmptyString(current.authMode),
    importedAt,
    lastValidatedAt: update.validatedAt || toNonEmptyString(current.lastValidatedAt),
    lastRefreshAt: update.refreshedAt || toNonEmptyString(current.lastRefreshAt),
    lastSessionError: update.error || null,
    requestHeaders:
      update.requestHeaders && Object.keys(update.requestHeaders).length > 0
        ? update.requestHeaders
        : toRecord(current.requestHeaders),
    authorizationHeader:
      update.authorizationHeader || toNonEmptyString(current.authorizationHeader) || null,
    models: Array.isArray(update.models) ? update.models : currentModels,
  };
}

export async function validateGeminiWebSession(
  rawInput: unknown,
  options: GeminiWebSessionValidationOptions = {}
): Promise<GeminiWebSessionValidationResult> {
  const normalized = normalizeGeminiSessionInput(rawInput);
  if (!normalized.valid) {
    return {
      valid: false,
      statusCode: 400,
      errorCode: normalized.errorCode,
      error: normalized.error,
      requestHeaders: {},
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const headers: Record<string, string> = {
    ...GEMINI_WEB_DEFAULT_HEADERS,
    ...normalized.requestHeaders,
  };

  if (normalized.authorization) {
    headers.Authorization = normalized.authorization;
  }

  let response: Response;
  try {
    response = await fetchImpl(GEMINI_WEB_VALIDATE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: {
          maxOutputTokens: 1,
        },
      }),
      signal: options.signal,
    });
  } catch (error: unknown) {
    return {
      valid: false,
      statusCode: null,
      errorCode: "network_error",
      error: error instanceof Error ? error.message : "Failed to reach Gemini endpoint",
      requestHeaders: normalized.requestHeaders,
    };
  }

  if (!response.ok) {
    const failure = buildGeminiValidationError(response.status);
    return {
      valid: false,
      statusCode: response.status,
      errorCode: failure.errorCode,
      error: failure.error,
      requestHeaders: normalized.requestHeaders,
    };
  }

  let models = GEMINI_WEB_FALLBACK_MODELS;
  let modelsPayload: Record<string, unknown> = {};
  try {
    const modelsResponse = await fetchImpl(GEMINI_WEB_MODELS_URL, {
      method: "GET",
      headers,
      signal: options.signal,
    });
    if (modelsResponse.ok) {
      const parsedPayload = (await modelsResponse.json()) as Record<string, unknown>;
      const parsedModels = parseGeminiModels(parsedPayload);
      if (parsedModels.length > 0) {
        models = parsedModels;
      }
      modelsPayload = parsedPayload;
    }
  } catch {
    // Best-effort only. Validation already succeeded on the same generateContent family used at runtime.
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch (error: unknown) {
    return {
      valid: false,
      statusCode: response.status,
      errorCode: "invalid_session_payload",
      error: error instanceof Error ? error.message : "Gemini returned invalid JSON payload",
      requestHeaders: normalized.requestHeaders,
    };
  }

  const bearerToken = maybeExtractBearerToken(normalized.authorization);
  const fallbackAccessToken = normalized.authorization || normalized.normalizedInput;

  return {
    valid: true,
    statusCode: response.status,
    accessToken: bearerToken || fallbackAccessToken,
    authMode: "authorization",
    apiKey: null,
    authorizationHeader: normalized.authorization,
    requestHeaders: normalized.requestHeaders,
    session: {
      id: null,
      email: null,
      name: null,
    },
    models,
    raw: Object.keys(modelsPayload).length > 0 ? modelsPayload : payload,
  };
}

export {
  GEMINI_WEB_MODELS_URL,
  GEMINI_WEB_VALIDATE_URL,
  GEMINI_WEB_DEFAULT_HEADERS,
  normalizeGeminiSessionInput as normalizeGeminiWebSessionInput,
};
