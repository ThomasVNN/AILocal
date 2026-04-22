import { createHash, randomUUID } from "node:crypto";

const GEMINI_WEB_ORIGIN = "https://gemini.google.com";
const GEMINI_WEB_STREAM_PATH =
  "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_WEB_APP_PATH = "/app";
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
  Accept: "*/*",
  Origin: GEMINI_WEB_ORIGIN,
  Referer: `${GEMINI_WEB_ORIGIN}/`,
  "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
  "x-same-domain": "1",
};

const GEMINI_WEB_MODEL_HEADER_KEY = "x-goog-ext-525001261-jspb";
const GEMINI_WEB_MODEL_CAPABILITY_MAP: Record<
  string,
  { modelId: string; capacityTail: number }
> = {
  "gemini-2.5-pro": { modelId: "e6fa609c3fa255c0", capacityTail: 2 },
  "gemini-3.1-pro": { modelId: "e6fa609c3fa255c0", capacityTail: 2 },
  "gemini-2.5-flash": { modelId: "56fdd199312815e2", capacityTail: 2 },
  "gemini-3.1-flash": { modelId: "56fdd199312815e2", capacityTail: 2 },
  "gemini-2.5-flash-lite": { modelId: "56fdd199312815e2", capacityTail: 2 },
  "gemini-3.1-flash-lite": { modelId: "56fdd199312815e2", capacityTail: 2 },
};

const GEMINI_WEB_DEFAULT_MODEL_HEADER_TEMPLATE = [
  1,
  null,
  null,
  null,
  "56fdd199312815e2",
  null,
  null,
  0,
  [4],
  null,
  null,
  2,
  null,
  null,
  1,
  1,
];

const GEMINI_WEB_DEFAULT_METADATA = ["", "", "", null, null, null, null, null, null, ""];
const GEMINI_WEB_LENGTH_MARKER_RE = /(\d+)\n/y;

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
      routePrefix: string;
      authUser: number | null;
      modelHeaderTemplate: string | null;
      cookieHeader: string | null;
      accessTokenHint: string | null;
      streamQueryParams: Record<string, string> | null;
      streamRequestTemplate: string | null;
      capturedRequests: GeminiWebCapturedCurlRequest[];
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
      routePrefix: string;
      authUser: number | null;
      modelHeaderTemplate: string | null;
      streamQueryParams: Record<string, string> | null;
      streamRequestTemplate: string | null;
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

type GeminiWebCapturedCurlRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  requestHeaders: Record<string, string>;
  rawBody: string | null;
  queryParams: Record<string, string>;
  formParams: Record<string, string>;
  routePrefix: string;
  requestType: "stream" | "batchexecute" | "unknown";
  rpcids: string | null;
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
  "content-type": "Content-Type",
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

function extractCurlTargetUrl(input: string): string | null {
  const match =
    /(?:^|\s)curl\s+\$?(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/ms.exec(input.trim());
  const rawValue = match ? decodeCurlQuotedValue(match[1] ?? match[2] ?? "").trim() : "";
  return rawValue || null;
}

function extractCurlCommands(input: string): string[] {
  const matches = input.match(/(?:^|\n)\s*(curl\b[\s\S]*?)(?=(?:\n\s*curl\b)|$)/gms);
  if (!matches) return [];
  return matches.map((entry) => entry.trim()).filter(Boolean);
}

function normalizeCurlCommandForParsing(input: string): string {
  let normalized = input.replace(/\\\r?\n[ \t]*/g, " ");
  for (let index = 0; index < 4; index += 1) {
    const next = normalized.replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (next === normalized) break;
    normalized = next;
  }
  return normalized;
}

function extractCurlMethod(input: string): string {
  const explicit =
    /(?:^|\s)(?:-X|--request)\s+\$?(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z]+))/ms.exec(
      input
    );
  const rawMethod = decodeCurlQuotedValue(
    explicit?.[1] ?? explicit?.[2] ?? explicit?.[3] ?? ""
  ).trim();
  if (rawMethod) return rawMethod.toUpperCase();

  if (/(?:^|\s)--data(?:-raw|-binary|-urlencode)?\b/ms.test(input)) {
    return "POST";
  }

  return "GET";
}

function extractCurlRawBody(input: string): string | null {
  const match =
    /(?:^|\s)(?:--data-raw|--data-binary|--data-urlencode|--data)\s+\$?(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/gms.exec(
      input
    );
  const rawValue = decodeCurlQuotedValue(match?.[1] ?? match?.[2] ?? "").trim();
  return rawValue || null;
}

function normalizeStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim();
    if (!normalized) continue;
    result[name] = normalized;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function parseSearchParamsRecord(value: string | null | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  const normalized = toNonEmptyString(value);
  if (!normalized) return params;

  const searchParams = new URLSearchParams(normalized);
  for (const [name, entry] of searchParams.entries()) {
    if (entry) params[name] = entry;
  }

  return params;
}

function extractGeminiStreamRequestTemplate(fReqValue: string | null): string | null {
  const normalized = toNonEmptyString(fReqValue);
  if (!normalized) return null;

  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed) && typeof parsed[1] === "string" && parsed[1].trim()) {
      return parsed[1].trim();
    }
  } catch {
    return null;
  }

  return null;
}

function parseGeminiCapturedCurlRequest(command: string): GeminiWebCapturedCurlRequest | null {
  const normalizedCommand = normalizeCurlCommandForParsing(command);
  const targetUrl = extractCurlTargetUrl(normalizedCommand);
  if (!targetUrl) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl, GEMINI_WEB_ORIGIN);
  } catch {
    return null;
  }

  if (parsedUrl.hostname !== "gemini.google.com") {
    return null;
  }

  const headers = extractHeadersFromCurlCommand(normalizedCommand);
  const requestHeaders = normalizeForwardedHeaders(headers);
  const rawBody = extractCurlRawBody(normalizedCommand);
  const queryParams = parseSearchParamsRecord(parsedUrl.search);
  const formParams = parseSearchParamsRecord(rawBody);
  const routePrefix = parseRoutePrefixFromUrl(parsedUrl.toString());
  const rpcids = queryParams.rpcids || null;
  const requestType = parsedUrl.pathname.includes("StreamGenerate")
    ? "stream"
    : parsedUrl.pathname.includes("/batchexecute")
      ? "batchexecute"
      : "unknown";

  return {
    url: parsedUrl.toString(),
    method: extractCurlMethod(normalizedCommand),
    headers,
    requestHeaders,
    rawBody,
    queryParams,
    formParams,
    routePrefix,
    requestType,
    rpcids,
  };
}

function extractGeminiCapturedCurlRequests(input: string): GeminiWebCapturedCurlRequest[] {
  return extractCurlCommands(input)
    .map((command) => parseGeminiCapturedCurlRequest(command))
    .filter((entry): entry is GeminiWebCapturedCurlRequest => entry !== null);
}

function parseRoutePrefixFromUrl(value: string | null): string {
  if (!value) return "";
  try {
    const url = new URL(value, GEMINI_WEB_ORIGIN);
    const match = /^\/u\/(\d+)(?:\/|$)/.exec(url.pathname);
    return match ? `/u/${match[1]}` : "";
  } catch {
    const match = /\/u\/(\d+)(?:\/|$)/.exec(value);
    return match ? `/u/${match[1]}` : "";
  }
}

function parseAuthUserValue(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

function parseAuthUserFromRoutePrefix(routePrefix: string): number | null {
  const match = /^\/u\/(\d+)$/.exec(routePrefix);
  return match ? Number.parseInt(match[1], 10) : null;
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
  const capturedRequests = stringInput ? extractGeminiCapturedCurlRequests(stringInput) : [];
  const capturedStreamRequest =
    capturedRequests.find((entry) => entry.requestType === "stream") || null;
  const storedStreamQueryParams = normalizeStringRecord(recordInput.streamQueryParams);
  const storedStreamRequestTemplate = toNonEmptyString(recordInput.streamRequestTemplate);
  const targetUrl =
    toNonEmptyString(recordInput.url) ||
    toNonEmptyString(recordInput.requestUrl) ||
    capturedStreamRequest?.url ||
    capturedRequests[0]?.url ||
    (stringInput ? extractCurlTargetUrl(stringInput) : null) ||
    toNonEmptyString(headers.referer) ||
    null;
  const explicitRoutePrefix = toNonEmptyString(recordInput.routePrefix);
  const explicitAuthUser =
    typeof recordInput.authUser === "number"
      ? recordInput.authUser
      : parseAuthUserValue(toNonEmptyString(recordInput.authUser));

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
  const accessTokenHint =
    toNonEmptyString(recordInput.accessToken) ||
    toNonEmptyString(recordInput.sessionToken) ||
    toNonEmptyString(recordInput.at) ||
    toNonEmptyString(capturedStreamRequest?.formParams.at) ||
    null;

  const apiKey = apiKeyFromHeaders || apiKeyFromRecord || apiKeyFromString;
  const authorization =
    authorizationFromHeaders ||
    authorizationFromRecord ||
    authorizationFromString ||
    authorizationFromCookies;
  const cookieHeader = toNonEmptyString(headers.cookie);
  const routePrefix =
    explicitRoutePrefix ||
    capturedStreamRequest?.routePrefix ||
    capturedRequests[0]?.routePrefix ||
    parseRoutePrefixFromUrl(targetUrl) ||
    parseRoutePrefixFromUrl(toNonEmptyString(headers.referer));
  const authUser =
    explicitAuthUser ??
    parseAuthUserValue(toNonEmptyString(headers["x-goog-authuser"])) ??
    parseAuthUserFromRoutePrefix(routePrefix);
  const modelHeaderTemplate =
    toNonEmptyString(recordInput.modelHeaderTemplate) ||
    toNonEmptyString(capturedStreamRequest?.requestHeaders[GEMINI_WEB_MODEL_HEADER_KEY]) ||
    toNonEmptyString(headers[GEMINI_WEB_MODEL_HEADER_KEY]);
  const streamQueryParams = storedStreamQueryParams || capturedStreamRequest?.queryParams || null;
  const streamRequestTemplate =
    storedStreamRequestTemplate ||
    extractGeminiStreamRequestTemplate(capturedStreamRequest?.formParams["f.req"] || null);

  if (!authorization && !cookieHeader && apiKey) {
    return {
      valid: false,
      errorCode: "gemini_api_key_not_supported",
      error:
        "Gemini Web2API only accepts browser-derived authorization headers or cookies from gemini.google.com. Add Gemini API keys under the official Gemini (Google AI Studio) provider instead.",
    };
  }

  const hasRequiredSessionCookie =
    typeof cookieHeader === "string" &&
    /(?:^|;\s*)__Secure-1PSID=/.test(cookieHeader);

  if (!authorization && !hasRequiredSessionCookie) {
    return {
      valid: false,
      errorCode: "missing_gemini_auth",
      error:
        "Missing Gemini web-session credentials. Paste browser request headers, a Copy as cURL capture, or Cookie data with __Secure-1PSID from gemini.google.com.",
    };
  }

  const requestHeaders = normalizeForwardedHeaders(headers);

  return {
    valid: true,
    authorization,
    requestHeaders,
    normalizedInput:
      typeof rawInput === "string" ? rawInput : JSON.stringify({ headers, authorization }),
    routePrefix,
    authUser,
    modelHeaderTemplate,
    cookieHeader,
    accessTokenHint,
    streamQueryParams,
    streamRequestTemplate,
    capturedRequests,
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
      error:
        "Gemini web-session credentials are invalid or expired. Re-import fresh browser headers or cookies.",
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

function getNestedValue(data: unknown, path: Array<number | string>, fallback: unknown = null): any {
  let current: any = data;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current) || key < 0 || key >= current.length) return fallback;
      current = current[key];
      continue;
    }
    if (!current || typeof current !== "object" || !(key in current)) return fallback;
    current = current[key];
  }
  return current ?? fallback;
}

function parseGeminiModels(_payload: Record<string, unknown>): Array<{ id: string; name: string }> {
  return GEMINI_WEB_FALLBACK_MODELS;
}

function resolveGeminiWebAppUrl(routePrefix: string): string {
  return `${GEMINI_WEB_ORIGIN}${routePrefix}${GEMINI_WEB_APP_PATH}`;
}

function resolveGeminiWebStreamUrl(routePrefix: string, params: Record<string, string>): string {
  const url = new URL(`${GEMINI_WEB_ORIGIN}${routePrefix}${GEMINI_WEB_STREAM_PATH}`);
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) {
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
}

function parseGeminiBootstrapState(html: string): {
  accessToken: string | null;
  buildLabel: string | null;
  sessionId: string | null;
  language: string | null;
  pushId: string | null;
} {
  const extract = (pattern: RegExp) => {
    const match = pattern.exec(html);
    return match?.[1]?.trim() || null;
  };

  return {
    accessToken: extract(/"SNlM0e":\s*"([^"]+)"/) || extract(/"thykhd":\s*"([^"]+)"/),
    buildLabel: extract(/"cfb2h":\s*"([^"]+)"/),
    sessionId: extract(/"FdrFJe":\s*"([^"]+)"/),
    language: extract(/"TuX5cc":\s*"([^"]+)"/),
    pushId: extract(/"qKIAYe":\s*"([^"]+)"/),
  };
}

function buildGeminiWebModelHeader(model: string, modelHeaderTemplate: string | null): string {
  const requestedModel = typeof model === "string" && model.trim() ? model.trim() : "gemini-2.5-flash";
  const fallbackTemplate = [...GEMINI_WEB_DEFAULT_MODEL_HEADER_TEMPLATE];

  let template = fallbackTemplate;
  if (modelHeaderTemplate) {
    try {
      const parsed = JSON.parse(modelHeaderTemplate);
      if (Array.isArray(parsed) && parsed.length > 0) {
        template = [...parsed];
      }
    } catch {
      template = fallbackTemplate;
    }
  }

  const mapped =
    GEMINI_WEB_MODEL_CAPABILITY_MAP[requestedModel] ||
    (/thinking/i.test(requestedModel)
      ? { modelId: "e051ce1aa80aa576", capacityTail: 2 }
      : /flash|lite/i.test(requestedModel)
        ? GEMINI_WEB_MODEL_CAPABILITY_MAP["gemini-2.5-flash"]
        : GEMINI_WEB_MODEL_CAPABILITY_MAP["gemini-2.5-pro"]);

  template[0] = 1;
  template[4] = mapped.modelId;
  template[7] = 0;
  template[8] = [4];
  template[11] = mapped.capacityTail ?? 2;
  template[14] = typeof template[14] === "number" ? template[14] : 1;
  template[15] = typeof template[15] === "number" ? template[15] : 1;

  return JSON.stringify(template);
}

function buildGeminiWebBootstrapHeaders(
  requestHeaders: Record<string, string>,
  routePrefix: string
): Record<string, string> {
  const headers: Record<string, string> = {
    ...GEMINI_WEB_DEFAULT_HEADERS,
    ...requestHeaders,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Origin: GEMINI_WEB_ORIGIN,
    Referer: `${GEMINI_WEB_ORIGIN}${routePrefix || "/"}`,
  };

  delete headers.Authorization;
  delete headers.authorization;
  delete headers["Content-Type"];
  delete headers["content-type"];

  return headers;
}

function buildGeminiWebStreamHeaders(
  requestHeaders: Record<string, string>,
  routePrefix: string,
  model: string,
  modelHeaderTemplate: string | null
): Record<string, string> {
  const requestId = randomUUID().toUpperCase();
  return {
    ...GEMINI_WEB_DEFAULT_HEADERS,
    ...requestHeaders,
    Accept: "*/*",
    Origin: GEMINI_WEB_ORIGIN,
    Referer: `${GEMINI_WEB_ORIGIN}${routePrefix || "/"}`,
    [GEMINI_WEB_MODEL_HEADER_KEY]: buildGeminiWebModelHeader(model, modelHeaderTemplate),
    "x-goog-ext-525005358-jspb": `["${requestId}",1]`,
    "x-goog-ext-73010989-jspb":
      toNonEmptyString(requestHeaders["x-goog-ext-73010989-jspb"]) || "[0]",
    "x-goog-ext-73010990-jspb":
      toNonEmptyString(requestHeaders["x-goog-ext-73010990-jspb"]) || "[0]",
    "x-same-domain": toNonEmptyString(requestHeaders["x-same-domain"]) || "1",
  };
}

function stringifyGeminiMessageContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      const entry = toRecord(part);
      if (entry.type === "text" || entry.type === "input_text") {
        return toNonEmptyString(entry.text) || "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildGeminiWebPrompt(body: unknown): string {
  const record = toRecord(body);
  const messages = Array.isArray(record.messages) ? record.messages : [];
  const sections: string[] = [];

  for (const rawMessage of messages) {
    const message = toRecord(rawMessage);
    const role = toNonEmptyString(message.role) || "user";
    const normalizedRole = role === "developer" ? "system" : role;
    const content = stringifyGeminiMessageContent(message.content);
    if (!content) continue;

    if (normalizedRole === "system") {
      sections.push(`System:\n${content}`);
    } else if (normalizedRole === "assistant") {
      sections.push(`Assistant:\n${content}`);
    } else {
      sections.push(`User:\n${content}`);
    }
  }

  if (sections.length === 0) {
    const fallbackPrompt = toNonEmptyString(record.prompt) || toNonEmptyString(record.input) || "";
    return fallbackPrompt;
  }

  return sections.join("\n\n").trim();
}

function replaceGeminiTemplateUuids(value: unknown): unknown {
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return randomUUID().toUpperCase();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => replaceGeminiTemplateUuids(entry));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(value)) {
      result[name] = replaceGeminiTemplateUuids(entry);
    }
    return result;
  }

  return value;
}

function buildGeminiWebTemplateBody(
  prompt: string,
  language: string,
  streamRequestTemplate: string
): URLSearchParams | null {
  try {
    const parsed = JSON.parse(streamRequestTemplate);
    if (!Array.isArray(parsed)) return null;

    const template = replaceGeminiTemplateUuids(parsed) as unknown[];
    if (Array.isArray(template[0])) {
      template[0][0] = prompt;
      if (template[0].length < 2) {
        template[0][1] = 0;
      }
    } else {
      template[0] = [prompt, 0, null, null, null, null, 0];
    }

    if (Array.isArray(template[1])) {
      if (template[1].length === 0) {
        template[1].push(language);
      } else {
        template[1][0] = language;
      }
    } else {
      template[1] = [language];
    }

    const form = new URLSearchParams();
    form.set("f.req", JSON.stringify([null, JSON.stringify(template)]));
    return form;
  } catch {
    return null;
  }
}

function buildGeminiWebStreamBody(
  prompt: string,
  language: string,
  streamRequestTemplate: string | null = null
): URLSearchParams {
  if (streamRequestTemplate) {
    const templated = buildGeminiWebTemplateBody(prompt, language, streamRequestTemplate);
    if (templated) {
      return templated;
    }
  }

  const innerRequest: Array<unknown> = new Array(69).fill(null);
  innerRequest[0] = [prompt, 0, null, null, null, null, 0];
  innerRequest[1] = [language];
  innerRequest[2] = GEMINI_WEB_DEFAULT_METADATA;
  innerRequest[6] = [1];
  innerRequest[7] = 1;
  innerRequest[10] = 1;
  innerRequest[11] = 0;
  innerRequest[17] = [[0]];
  innerRequest[18] = 0;
  innerRequest[27] = 1;
  innerRequest[30] = [4];
  innerRequest[41] = [1];
  innerRequest[53] = 0;
  innerRequest[59] = randomUUID().toUpperCase();
  innerRequest[61] = [];
  innerRequest[68] = 2;

  const form = new URLSearchParams();
  form.set("f.req", JSON.stringify([null, JSON.stringify(innerRequest)]));
  return form;
}

function getUtf16CharCount(
  input: string,
  startIndex: number,
  utf16Units: number
): { charCount: number; unitsFound: number } {
  let charCount = 0;
  let unitsFound = 0;

  while (unitsFound < utf16Units && startIndex + charCount < input.length) {
    const codePoint = input.codePointAt(startIndex + charCount);
    if (typeof codePoint !== "number") break;
    const units = codePoint > 0xffff ? 2 : 1;
    if (unitsFound + units > utf16Units) break;
    unitsFound += units;
    charCount += codePoint > 0xffff ? 2 : 1;
  }

  return { charCount, unitsFound };
}

export function parseGeminiWebResponseFrames(content: string): {
  parts: unknown[];
  remaining: string;
} {
  let buffer = content.startsWith(")]}'") ? content.slice(4).trimStart() : content;
  let cursor = 0;
  const parts: unknown[] = [];

  while (cursor < buffer.length) {
    while (cursor < buffer.length && /\s/.test(buffer[cursor])) {
      cursor += 1;
    }
    if (cursor >= buffer.length) break;

    GEMINI_WEB_LENGTH_MARKER_RE.lastIndex = cursor;
    const match = GEMINI_WEB_LENGTH_MARKER_RE.exec(buffer);
    if (!match) break;

    const length = Number.parseInt(match[1] || "0", 10);
    const start = match.index + match[1].length;
    const { charCount, unitsFound } = getUtf16CharCount(buffer, start, length);
    if (unitsFound < length) break;

    const end = start + charCount;
    const chunk = buffer.slice(start, end).trim();
    cursor = end;
    if (!chunk) continue;

    try {
      const parsed = JSON.parse(chunk);
      if (Array.isArray(parsed)) {
        parts.push(...parsed);
      } else {
        parts.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return { parts, remaining: buffer.slice(cursor) };
}

export function extractGeminiWebResponseState(parts: unknown[]): {
  text: string;
  thoughts: string;
  completed: boolean;
  errorCode: string | null;
} {
  let latestText = "";
  let latestThoughts = "";
  let completed = false;
  let errorCode: string | null = null;

  for (const part of parts) {
    const partError = getNestedValue(part, [5, 2, 0, 1, 0], null);
    if (partError) {
      errorCode = String(partError);
    }

    const innerJsonString = getNestedValue(part, [2], null);
    if (typeof innerJsonString !== "string" || !innerJsonString) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(innerJsonString);
    } catch {
      continue;
    }

    const candidates = getNestedValue(parsed, [4], []);
    if (!Array.isArray(candidates)) continue;

    for (const candidate of candidates) {
      const text = getNestedValue(candidate, [1, 0], "");
      const thoughts = getNestedValue(candidate, [37, 0, 0], "");
      const doneFlag = getNestedValue(candidate, [8, 0], null);
      if (typeof text === "string" && text.length > 0) {
        latestText = text;
      }
      if (typeof thoughts === "string" && thoughts.length > 0) {
        latestThoughts = thoughts;
      }
      if (doneFlag === 2) {
        completed = true;
      }
    }
  }

  return { text: latestText, thoughts: latestThoughts, completed, errorCode };
}

export async function bootstrapGeminiWebRuntime(
  rawInput: unknown,
  options: GeminiWebSessionValidationOptions = {}
):
  Promise<
    | {
        valid: true;
        accessToken: string;
        buildLabel: string | null;
        sessionId: string | null;
        language: string;
        pushId: string | null;
        routePrefix: string;
        authUser: number | null;
        appUrl: string;
        requestHeaders: Record<string, string>;
        modelHeaderTemplate: string | null;
        streamQueryParams: Record<string, string> | null;
        streamRequestTemplate: string | null;
      }
    | {
        valid: false;
        statusCode: number | null;
        errorCode: string;
        error: string;
        requestHeaders: Record<string, string>;
      }
  > {
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

  const appUrl = resolveGeminiWebAppUrl(normalized.routePrefix);
  if (
    normalized.accessTokenHint &&
    normalized.streamQueryParams &&
    normalized.streamRequestTemplate
  ) {
    return {
      valid: true,
      accessToken: normalized.accessTokenHint,
      buildLabel: normalized.streamQueryParams.bl || null,
      sessionId: normalized.streamQueryParams["f.sid"] || null,
      language: normalized.streamQueryParams.hl || "en",
      pushId: normalized.streamQueryParams.pushId || null,
      routePrefix: normalized.routePrefix,
      authUser: normalized.authUser,
      appUrl,
      requestHeaders: normalized.requestHeaders,
      modelHeaderTemplate: normalized.modelHeaderTemplate,
      streamQueryParams: normalized.streamQueryParams,
      streamRequestTemplate: normalized.streamRequestTemplate,
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const bootstrapHeaders = buildGeminiWebBootstrapHeaders(
    normalized.requestHeaders,
    normalized.routePrefix
  );

  let response: Response;
  try {
    response = await fetchImpl(appUrl, {
      method: "GET",
      headers: bootstrapHeaders,
      signal: options.signal,
    });
  } catch (error: unknown) {
    return {
      valid: false,
      statusCode: null,
      errorCode: "network_error",
      error: error instanceof Error ? error.message : "Failed to reach Gemini web app",
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

  const html = await response.text();
  const state = parseGeminiBootstrapState(html);
  if (!state.accessToken) {
    return {
      valid: false,
      statusCode: response.status,
      errorCode: "invalid_session_payload",
      error: "Gemini bootstrap page did not expose a usable web-session token.",
      requestHeaders: normalized.requestHeaders,
    };
  }

  return {
    valid: true,
    accessToken: state.accessToken,
    buildLabel: state.buildLabel,
    sessionId: state.sessionId,
    language: state.language || "en",
    pushId: state.pushId,
    routePrefix: normalized.routePrefix,
    authUser: normalized.authUser,
    appUrl,
    requestHeaders: normalized.requestHeaders,
    modelHeaderTemplate: normalized.modelHeaderTemplate,
    streamQueryParams: normalized.streamQueryParams,
    streamRequestTemplate: normalized.streamRequestTemplate,
  };
}

export function buildGeminiWebSessionProviderData(
  existing: Record<string, unknown> | null | undefined,
  update: {
    sessionStatus: string;
    authMode?: "x-goog-api-key" | "authorization";
    requestHeaders?: Record<string, string>;
    authorizationHeader?: string | null;
    routePrefix?: string | null;
    authUser?: number | null;
    modelHeaderTemplate?: string | null;
    streamQueryParams?: Record<string, string> | null;
    streamRequestTemplate?: string | null;
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
    routePrefix: update.routePrefix || toNonEmptyString(current.routePrefix) || "",
    authUser:
      typeof update.authUser === "number"
        ? update.authUser
        : typeof current.authUser === "number"
          ? current.authUser
          : null,
    modelHeaderTemplate:
      update.modelHeaderTemplate ||
      toNonEmptyString(current.modelHeaderTemplate) ||
      null,
    streamQueryParams:
      (update.streamQueryParams && Object.keys(update.streamQueryParams).length > 0
        ? update.streamQueryParams
        : normalizeStringRecord(current.streamQueryParams)) || null,
    streamRequestTemplate:
      update.streamRequestTemplate ||
      toNonEmptyString(current.streamRequestTemplate) ||
      null,
    models: Array.isArray(update.models) ? update.models : currentModels,
  };
}

function rankGeminiCapturedRequest(request: GeminiWebCapturedCurlRequest): number {
  if (request.requestType === "batchexecute" && request.rpcids === "aPya6c") return 0;
  if (request.requestType === "stream") return 1;
  if (request.requestType === "batchexecute" && request.rpcids === "PCck7e") return 2;
  if (request.requestType === "batchexecute" && request.rpcids === "qpEbW") return 3;
  if (request.requestType === "batchexecute") return 4;
  return 5;
}

function buildGeminiCapturedRequestHeaders(
  requestHeaders: Record<string, string>,
  routePrefix: string
): Record<string, string> {
  return {
    ...GEMINI_WEB_DEFAULT_HEADERS,
    ...requestHeaders,
    Origin: GEMINI_WEB_ORIGIN,
    Referer:
      toNonEmptyString(requestHeaders.Referer) ||
      toNonEmptyString(requestHeaders.referer) ||
      `${GEMINI_WEB_ORIGIN}${routePrefix || "/"}`,
  };
}

async function replayGeminiCapturedRequest(
  capture: GeminiWebCapturedCurlRequest,
  options: GeminiWebSessionValidationOptions = {}
): Promise<Response> {
  const fetchImpl = options.fetchImpl || fetch;
  const headers = buildGeminiCapturedRequestHeaders(capture.requestHeaders, capture.routePrefix);
  return fetchImpl(capture.url, {
    method: capture.method || "POST",
    headers,
    body: capture.rawBody,
    signal: options.signal,
  });
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

  const capturedRequests = [...normalized.capturedRequests].sort(
    (left, right) => rankGeminiCapturedRequest(left) - rankGeminiCapturedRequest(right)
  );
  for (const capture of capturedRequests) {
    if (!capture.rawBody) continue;

    let replayResponse: Response;
    try {
      replayResponse = await replayGeminiCapturedRequest(capture, options);
    } catch (error: unknown) {
      return {
        valid: false,
        statusCode: null,
        errorCode: "network_error",
        error: error instanceof Error ? error.message : "Failed to reach Gemini endpoint",
        requestHeaders: capture.requestHeaders,
      };
    }

    if (replayResponse.ok) {
      const models = parseGeminiModels({});
      const requestHeaders =
        capture.requestType === "stream" && Object.keys(capture.requestHeaders).length > 0
          ? capture.requestHeaders
          : normalized.requestHeaders;
      const routePrefix = capture.routePrefix || normalized.routePrefix;
      const streamQueryParams =
        capture.requestType === "stream"
          ? capture.queryParams
          : normalized.streamQueryParams;
      const streamRequestTemplate =
        capture.requestType === "stream"
          ? extractGeminiStreamRequestTemplate(capture.formParams["f.req"] || null)
          : normalized.streamRequestTemplate;

      return {
        valid: true,
        statusCode: replayResponse.status,
        accessToken:
          toNonEmptyString(capture.formParams.at) ||
          normalized.accessTokenHint ||
          "",
        authMode: "authorization",
        apiKey: null,
        authorizationHeader: null,
        requestHeaders,
        routePrefix,
        authUser:
          parseAuthUserValue(
            toNonEmptyString(capture.requestHeaders["x-goog-authuser"]) ||
              toNonEmptyString(capture.headers["x-goog-authuser"])
          ) ?? normalized.authUser,
        modelHeaderTemplate:
          toNonEmptyString(capture.requestHeaders[GEMINI_WEB_MODEL_HEADER_KEY]) ||
          normalized.modelHeaderTemplate,
        streamQueryParams,
        streamRequestTemplate,
        session: {
          id: null,
          email: null,
          name: null,
        },
        models,
        raw: {
          validationMode: "captured_request_replay",
          url: capture.url,
          requestType: capture.requestType,
          rpcids: capture.rpcids,
        },
      };
    }

    if (replayResponse.status === 401 || replayResponse.status === 403) {
      const failure = buildGeminiValidationError(replayResponse.status);
      return {
        valid: false,
        statusCode: replayResponse.status,
        errorCode: failure.errorCode,
        error: failure.error,
        requestHeaders: capture.requestHeaders,
      };
    }
  }

  const runtime = await bootstrapGeminiWebRuntime(rawInput, options);
  if (!runtime.valid) {
    return runtime;
  }

  const fetchImpl = options.fetchImpl || fetch;
  const headers = buildGeminiWebStreamHeaders(
    runtime.requestHeaders,
    runtime.routePrefix,
    "gemini-2.5-flash",
    runtime.modelHeaderTemplate
  );
  const form = buildGeminiWebStreamBody("hi", runtime.language, runtime.streamRequestTemplate);
  form.set("at", runtime.accessToken);

  const streamUrl = resolveGeminiWebStreamUrl(runtime.routePrefix, {
    bl: runtime.streamQueryParams?.bl || runtime.buildLabel || "",
    "f.sid": runtime.streamQueryParams?.["f.sid"] || runtime.sessionId || "",
    hl: runtime.streamQueryParams?.hl || runtime.language,
    pageId: runtime.streamQueryParams?.pageId || "none",
    _reqid: String(100000 + Math.floor(Math.random() * 900000)),
    rt: runtime.streamQueryParams?.rt || "c",
  });

  let response: Response;
  try {
    response = await fetchImpl(streamUrl, {
      method: "POST",
      headers,
      body: form.toString(),
      signal: options.signal,
    });
  } catch (error: unknown) {
    return {
      valid: false,
      statusCode: null,
      errorCode: "network_error",
      error: error instanceof Error ? error.message : "Failed to reach Gemini endpoint",
      requestHeaders: runtime.requestHeaders,
    };
  }

  if (!response.ok) {
    const failure = buildGeminiValidationError(response.status);
    return {
      valid: false,
      statusCode: response.status,
      errorCode: failure.errorCode,
      error: failure.error,
      requestHeaders: runtime.requestHeaders,
    };
  }

  const payloadText = await response.text();
  const parsed = parseGeminiWebResponseFrames(payloadText);
  const state = extractGeminiWebResponseState(parsed.parts);
  if (state.errorCode) {
    return {
      valid: false,
      statusCode: response.status,
      errorCode: "invalid_credentials",
      error: `Gemini web session rejected the request (${state.errorCode}).`,
      requestHeaders: runtime.requestHeaders,
    };
  }

  if (!state.text && !state.thoughts && parsed.parts.length === 0) {
    return {
      valid: false,
      statusCode: response.status,
      errorCode: "invalid_session_payload",
      error: "Gemini returned an unexpected web-session payload.",
      requestHeaders: runtime.requestHeaders,
    };
  }

  const models = parseGeminiModels({});
  const bearerToken = maybeExtractBearerToken(null);
  const fallbackAccessToken = runtime.accessToken;

  return {
    valid: true,
    statusCode: response.status,
    accessToken: bearerToken || fallbackAccessToken,
    authMode: "authorization",
    apiKey: null,
    authorizationHeader: null,
    requestHeaders: runtime.requestHeaders,
    routePrefix: runtime.routePrefix,
    authUser: runtime.authUser,
    modelHeaderTemplate: runtime.modelHeaderTemplate,
    streamQueryParams: runtime.streamQueryParams,
    streamRequestTemplate: runtime.streamRequestTemplate,
    session: {
      id: null,
      email: null,
      name: null,
    },
    models,
    raw: {
      buildLabel: runtime.buildLabel,
      sessionId: runtime.sessionId,
      routePrefix: runtime.routePrefix,
      parts: parsed.parts.length,
      textPreview: state.text.slice(0, 160),
    },
  };
}

export {
  GEMINI_WEB_ORIGIN,
  GEMINI_WEB_STREAM_PATH,
  GEMINI_WEB_DEFAULT_HEADERS,
  GEMINI_WEB_MODEL_HEADER_KEY,
  normalizeGeminiSessionInput as normalizeGeminiWebSessionInput,
  buildGeminiWebModelHeader,
  buildGeminiWebPrompt,
  buildGeminiWebStreamHeaders,
  buildGeminiWebStreamBody,
  resolveGeminiWebStreamUrl,
};
