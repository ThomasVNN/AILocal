const CHATGPT_SESSION_URL = "https://chatgpt.com/api/auth/session";
const CHATGPT_CONVERSATION_LIMIT_URL = "https://chatgpt.com/public-api/conversation_limit";
const CHATGPT_WEB_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  Origin: "https://chatgpt.com",
  Referer: "https://chatgpt.com/",
};

type CookieNormalizationOptions = {
  allowBareSessionToken?: boolean;
};

type CookieNormalizationResult =
  | {
      valid: true;
      cookieString: string;
      cookieNames: string[];
    }
  | {
      valid: false;
      errorCode: string;
      error: string;
    };

type ChatgptSessionValidationOptions = CookieNormalizationOptions & {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

type ChatgptSessionPayloadValidationOptions = CookieNormalizationOptions;
type ChatgptAccessTokenValidationOptions = {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

type ChatgptSessionUser = {
  id: string | null;
  email: string | null;
  name: string | null;
};

type ChatgptSessionValidationResult =
  | {
      valid: true;
      statusCode: number;
      accessToken: string;
      cookieString: string;
      cookieNames: string[];
      setCookieNames: string[];
      session: ChatgptSessionUser;
      accountId: string | null;
      planType: string | null;
      expiresIn: number;
      raw: Record<string, unknown>;
    }
  | {
      valid: false;
      statusCode: number | null;
      errorCode: string;
      error: string;
      cookieNames: string[];
    };

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractCookieEntriesFromJson(raw: string): Array<{ name: string; value: string }> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    return null;
  }

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

    if (!Array.isArray(entries) || entries.length === 0) {
      return null;
    }

    const normalized: Array<{ name: string; value: string }> = [];
    for (const entry of entries) {
      const cookie = toRecord(entry);
      const name =
        toNullableString(cookie.name) ||
        toNullableString(cookie.key) ||
        toNullableString(cookie.cookieName);
      const value =
        toNullableString(cookie.value) ||
        toNullableString(cookie.cookieValue) ||
        toNullableString(cookie.content);
      if (!name || !value) continue;
      normalized.push({ name, value });
    }

    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function extractSessionToken(payload: Record<string, unknown>): string | null {
  return (
    toNullableString(payload.sessionToken) ||
    toNullableString(payload.session_token) ||
    toNullableString(payload.sessionTokenValue) ||
    null
  );
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

/**
 * Keep only essential ChatGPT cookies to avoid oversized Cookie headers (HTTP 431).
 * Preserves session auth and device continuity while dropping noisy browser cookies.
 */
export function compactChatgptCookieString(rawCookieString: unknown): string {
  const normalized = normalizeChatgptCookieString(rawCookieString, {
    allowBareSessionToken: true,
  });
  if (!normalized.valid) return typeof rawCookieString === "string" ? rawCookieString : "";

  const { cookies } = parseCookiePairs(normalized.cookieString);
  const preferredOrder = ["__Secure-next-auth.session-token", "oai-did", "cf_clearance", "__cf_bm"];

  const compact = new Map<string, string>();
  for (const name of preferredOrder) {
    const value = cookies.get(name);
    if (value) compact.set(name, value);
  }

  // If we don't have the required session cookie, keep the original normalized string.
  if (!compact.has("__Secure-next-auth.session-token")) {
    return normalized.cookieString;
  }

  return formatCookieMap(compact);
}

function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  const parts = accessToken.split(".");
  if (parts.length < 2) return null;

  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const remainder = payload.length % 4;
    if (remainder === 2) payload += "==";
    else if (remainder === 3) payload += "=";
    else if (remainder === 1) return null;

    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return toRecord(decoded);
  } catch {
    return null;
  }
}

function decodeJwtExp(accessToken: string): number | null {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  return exp;
}

function getExpiresInSeconds(payload: Record<string, unknown>, accessToken: string): number {
  let candidateMs: number | null = null;

  const expiresRaw = payload.expires;
  if (typeof expiresRaw === "string" && expiresRaw.trim().length > 0) {
    const parsed = new Date(expiresRaw).getTime();
    if (Number.isFinite(parsed) && parsed > Date.now()) {
      candidateMs = parsed;
    }
  }

  const jwtExp = decodeJwtExp(accessToken);
  if (jwtExp && jwtExp * 1000 > Date.now()) {
    const jwtMs = jwtExp * 1000;
    candidateMs = candidateMs ? Math.min(candidateMs, jwtMs) : jwtMs;
  }

  if (!candidateMs) {
    // Conservative default (30 minutes) when expiry is not available.
    return 30 * 60;
  }

  return Math.max(60, Math.floor((candidateMs - Date.now()) / 1000));
}

function getAccountIdFromAccounts(accounts: unknown): {
  accountId: string | null;
  planType: string | null;
} {
  if (!Array.isArray(accounts)) return { accountId: null, planType: null };

  const normalized = accounts
    .map((item) => toRecord(item))
    .filter((item) => Object.keys(item).length > 0);

  if (normalized.length === 0) return { accountId: null, planType: null };

  const pick =
    normalized.find((item) => item.is_default === true || item.isDefault === true) || normalized[0];

  const accountId =
    toNullableString(pick.account_id) ||
    toNullableString(pick.accountId) ||
    toNullableString(pick.id) ||
    null;

  const planType = toNullableString(pick.plan_type) || toNullableString(pick.planType) || null;

  return { accountId, planType };
}

function extractAccountContext(payload: Record<string, unknown>) {
  const accountRecord = toRecord(payload.account);
  const accountFromAccount = {
    accountId:
      toNullableString(accountRecord.id) ||
      toNullableString(accountRecord.account_id) ||
      toNullableString(accountRecord.accountId) ||
      null,
    planType:
      toNullableString(accountRecord.planType) || toNullableString(accountRecord.plan_type) || null,
  };

  const explicitAccountId =
    toNullableString(payload.account_id) ||
    toNullableString(payload.accountId) ||
    toNullableString(payload.default_account_id) ||
    toNullableString(payload.defaultAccountId) ||
    null;

  const fromAccounts = getAccountIdFromAccounts(payload.accounts);

  return {
    accountId: explicitAccountId || accountFromAccount.accountId || fromAccounts.accountId,
    planType:
      toNullableString(payload.plan_type) ||
      toNullableString(payload.planType) ||
      accountFromAccount.planType ||
      fromAccounts.planType,
  };
}

function extractAccountContextFromAccessToken(accessToken: string): {
  accountId: string | null;
  planType: string | null;
} {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return { accountId: null, planType: null };

  const authClaims = toRecord(payload["https://api.openai.com/auth"]);

  const accountId =
    toNullableString(authClaims.chatgpt_account_id) ||
    toNullableString(authClaims.chatgptAccountId) ||
    toNullableString(authClaims.chatgpt_workspace_id) ||
    toNullableString(authClaims.chatgptWorkspaceId) ||
    null;

  const planType =
    toNullableString(authClaims.chatgpt_plan_type) ||
    toNullableString(authClaims.chatgptPlanType) ||
    null;

  return { accountId, planType };
}

export function normalizeChatgptCookieString(
  rawCookieString: unknown,
  options: CookieNormalizationOptions = {}
): CookieNormalizationResult {
  const trimmed = typeof rawCookieString === "string" ? rawCookieString.trim() : "";
  if (!trimmed) {
    return {
      valid: false,
      errorCode: "missing_cookie",
      error: "Cookie string is required",
    };
  }

  const withoutHeader = trimmed.replace(/^cookie\s*:\s*/i, "").trim();

  if (!withoutHeader.includes("=")) {
    const cookieEntries = extractCookieEntriesFromJson(withoutHeader);
    if (cookieEntries && cookieEntries.length > 0) {
      const cookies = new Map<string, string>();
      const cookieNames: string[] = [];

      for (const entry of cookieEntries) {
        if (!cookies.has(entry.name)) cookieNames.push(entry.name);
        cookies.set(entry.name, entry.value);
      }

      return {
        valid: true,
        cookieString: formatCookieMap(cookies),
        cookieNames,
      };
    }

    if (options.allowBareSessionToken) {
      const cookieString = `__Secure-next-auth.session-token=${withoutHeader}`;
      return {
        valid: true,
        cookieString,
        cookieNames: ["__Secure-next-auth.session-token"],
      };
    }

    return {
      valid: false,
      errorCode: "invalid_cookie_format",
      error:
        "Invalid cookie format — paste Cookie header value or JSON cookie export ([{name,value}, ...])",
    };
  }

  const { cookies, cookieNames } = parseCookiePairs(withoutHeader);
  if (cookies.size === 0) {
    return {
      valid: false,
      errorCode: "invalid_cookie_format",
      error:
        "Invalid cookie format — paste Cookie header value or JSON cookie export ([{name,value}, ...])",
    };
  }

  return {
    valid: true,
    cookieString: formatCookieMap(cookies),
    cookieNames,
  };
}

export function getSetCookieHeaders(headers: Headers) {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie().filter(Boolean);
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

export function mergeChatgptCookieHeaders(
  cookieString: string,
  setCookieHeaders: string[] | null | undefined
) {
  const { cookies } = parseCookiePairs(cookieString);
  const mergedNames = new Set<string>();

  for (const header of setCookieHeaders || []) {
    const firstPart = String(header || "")
      .split(";")[0]
      ?.trim();
    if (!firstPart) continue;
    const eqIdx = firstPart.indexOf("=");
    if (eqIdx <= 0) continue;

    const name = firstPart.slice(0, eqIdx).trim();
    const value = firstPart.slice(eqIdx + 1).trim();
    if (!name || !value) continue;

    cookies.set(name, value);
    mergedNames.add(name);
  }

  return {
    cookieString: formatCookieMap(cookies),
    cookieNames: Array.from(cookies.keys()),
    setCookieNames: Array.from(mergedNames),
  };
}

function buildChatgptSessionError(statusCode: number | null) {
  if (statusCode === 401) {
    return {
      errorCode: "session_expired",
      error: "Session expired or invalid — reconnect via dashboard",
    };
  }

  if (statusCode === 403) {
    return {
      errorCode: "session_forbidden",
      error: "Session invalid or forbidden — please reconnect with fresh cookies",
    };
  }

  if (statusCode === 429) {
    return {
      errorCode: "rate_limited",
      error: "ChatGPT web endpoint rate-limited this session — try again shortly",
    };
  }

  if (statusCode === 431) {
    return {
      errorCode: "cookie_header_too_large",
      error: "Cookie header too large — re-import using session payload or compact cookies",
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
      ? `ChatGPT session check returned ${statusCode}`
      : "Session validation failed",
  };
}

export function buildChatgptSessionProviderData(
  existing: Record<string, unknown> | null | undefined,
  update: {
    sessionStatus: string;
    session?: ChatgptSessionUser | null;
    cookieNames?: string[];
    cookieString?: string | null;
    accountId?: string | null;
    planType?: string | null;
    error?: string | null;
    importedAt?: string | null;
    validatedAt?: string | null;
    refreshedAt?: string | null;
    sessionSource?: string;
  }
) {
  const current = existing && typeof existing === "object" ? existing : {};
  const session = update.session || null;
  const importedAt =
    update.importedAt || toNullableString(current.importedAt) || update.validatedAt || null;

  const nextAccountId =
    update.accountId ||
    toNullableString((current as Record<string, unknown>).workspaceId) ||
    toNullableString((current as Record<string, unknown>).chatgptAccountId) ||
    null;

  return {
    ...current,
    authMethod: "web2api",
    sessionSource:
      update.sessionSource || toNullableString(current.sessionSource) || "browser_cookie_header",
    sessionStatus: update.sessionStatus,
    importedAt,
    lastValidatedAt: update.validatedAt || toNullableString(current.lastValidatedAt),
    lastRefreshAt: update.refreshedAt || toNullableString(current.lastRefreshAt),
    lastSessionError: update.error || null,
    cookieString: update.cookieString || toNullableString(current.cookieString),
    cookieNames:
      Array.isArray(update.cookieNames) && update.cookieNames.length > 0
        ? update.cookieNames
        : Array.isArray(current.cookieNames)
          ? current.cookieNames
          : [],
    sessionUserId: session?.id || toNullableString(current.sessionUserId),
    sessionEmail: session?.email || toNullableString(current.sessionEmail),
    sessionName: session?.name || toNullableString(current.sessionName),
    workspaceId: nextAccountId,
    chatgptAccountId: nextAccountId,
    workspacePlanType:
      update.planType || toNullableString((current as Record<string, unknown>).workspacePlanType),
  };
}

export async function validateChatgptSessionPayload(
  rawPayload: unknown,
  options: ChatgptSessionPayloadValidationOptions = {}
): Promise<ChatgptSessionValidationResult> {
  const payload = toRecord(rawPayload);
  if (Object.keys(payload).length === 0) {
    return {
      valid: false,
      statusCode: 400,
      errorCode: "invalid_session_payload",
      error: "Session payload is required",
      cookieNames: [],
    };
  }

  const user = toRecord(payload.user);
  if (Object.keys(user).length === 0) {
    return {
      valid: false,
      statusCode: 400,
      errorCode: "session_missing_user",
      error: "Session payload missing user data",
      cookieNames: [],
    };
  }

  const accessToken =
    toNullableString(payload.accessToken) || toNullableString(payload.access_token) || null;
  if (!accessToken) {
    return {
      valid: false,
      statusCode: 400,
      errorCode: "missing_access_token",
      error: "Session payload missing access token",
      cookieNames: [],
    };
  }

  const sessionToken = extractSessionToken(payload);
  const cookieCandidate =
    toNullableString(payload.cookieString) ||
    toNullableString(payload.cookie) ||
    toNullableString(payload.sessionCookie) ||
    null;

  let normalized: CookieNormalizationResult | null = null;
  if (sessionToken) {
    normalized = normalizeChatgptCookieString(sessionToken, { allowBareSessionToken: true });
  } else if (cookieCandidate) {
    normalized = normalizeChatgptCookieString(cookieCandidate, options);
  }

  const accountContext = extractAccountContext(payload);
  const tokenContext = extractAccountContextFromAccessToken(accessToken);
  if (!normalized) {
    // Access-token-only mode (no cookie/session token). Useful when session token
    // is unavailable or too large for browser cookie replay.
    return {
      valid: true,
      statusCode: 200,
      accessToken,
      cookieString: "",
      cookieNames: [],
      setCookieNames: [],
      session: {
        id: toNullableString(user.id),
        email: toNullableString(user.email),
        name: toNullableString(user.name),
      },
      accountId: accountContext.accountId || tokenContext.accountId,
      planType: accountContext.planType || tokenContext.planType,
      expiresIn: getExpiresInSeconds(payload, accessToken),
      raw: payload,
    };
  }

  if (!normalized.valid) {
    return {
      valid: false,
      statusCode: 400,
      errorCode: normalized.errorCode,
      error: normalized.error,
      cookieNames: [],
    };
  }

  return {
    valid: true,
    statusCode: 200,
    accessToken,
    cookieString: normalized.cookieString,
    cookieNames: normalized.cookieNames,
    setCookieNames: [],
    session: {
      id: toNullableString(user.id),
      email: toNullableString(user.email),
      name: toNullableString(user.name),
    },
    accountId: accountContext.accountId || tokenContext.accountId,
    planType: accountContext.planType || tokenContext.planType,
    expiresIn: getExpiresInSeconds(payload, accessToken),
    raw: payload,
  };
}

export async function validateChatgptSessionCookie(
  rawCookieString: unknown,
  options: ChatgptSessionValidationOptions = {}
): Promise<ChatgptSessionValidationResult> {
  const normalized = normalizeChatgptCookieString(rawCookieString, options);
  if (!normalized.valid) {
    return {
      valid: false,
      statusCode: 400,
      errorCode: normalized.errorCode,
      error: normalized.error,
      cookieNames: [],
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  let response: Response;
  let effectiveCookieString = normalized.cookieString;

  try {
    const requestSession = async (cookieString: string) =>
      await fetchImpl(CHATGPT_SESSION_URL, {
        method: "GET",
        headers: {
          ...CHATGPT_WEB_HEADERS,
          Cookie: cookieString,
        },
        signal: options.signal,
      });

    response = await requestSession(normalized.cookieString);

    // Oversized cookie headers are common when users paste the entire browser Cookie.
    // Retry once with compact auth cookies before declaring validation failure.
    if (response.status === 431) {
      const compact = compactChatgptCookieString(normalized.cookieString);
      if (compact && compact !== normalized.cookieString) {
        response = await requestSession(compact);
        effectiveCookieString = compact;
      }
    }
  } catch (error: unknown) {
    return {
      valid: false,
      statusCode: null,
      errorCode: "network_error",
      error: error instanceof Error ? error.message : "Failed to validate cookies",
      cookieNames: normalized.cookieNames,
    };
  }

  if (!response.ok) {
    const failure = buildChatgptSessionError(response.status);
    return {
      valid: false,
      statusCode: response.status,
      errorCode: failure.errorCode,
      error: failure.error,
      cookieNames: normalized.cookieNames,
    };
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch (error: unknown) {
    return {
      valid: false,
      statusCode: response.status,
      errorCode: "invalid_session_payload",
      error: error instanceof Error ? error.message : "ChatGPT returned an invalid session payload",
      cookieNames: normalized.cookieNames,
    };
  }

  const user = toRecord(payload.user);
  if (Object.keys(user).length === 0) {
    return {
      valid: false,
      statusCode: response.status,
      errorCode: "session_missing_user",
      error: "Cookie valid but no user data found — session may have expired",
      cookieNames: normalized.cookieNames,
    };
  }

  const accessToken =
    toNullableString(payload.accessToken) || toNullableString(payload.access_token) || null;
  if (!accessToken) {
    return {
      valid: false,
      statusCode: response.status,
      errorCode: "missing_access_token",
      error: "Cookie valid but no API access token was returned by ChatGPT session endpoint",
      cookieNames: normalized.cookieNames,
    };
  }

  const mergedCookies = mergeChatgptCookieHeaders(
    effectiveCookieString,
    getSetCookieHeaders(response.headers)
  );

  const accountContext = extractAccountContext(payload);
  const tokenContext = extractAccountContextFromAccessToken(accessToken);

  return {
    valid: true,
    statusCode: response.status,
    accessToken,
    cookieString: mergedCookies.cookieString,
    cookieNames: mergedCookies.cookieNames,
    setCookieNames: mergedCookies.setCookieNames,
    session: {
      id: toNullableString(user.id),
      email: toNullableString(user.email),
      name: toNullableString(user.name),
    },
    accountId: accountContext.accountId || tokenContext.accountId,
    planType: accountContext.planType || tokenContext.planType,
    expiresIn: getExpiresInSeconds(payload, accessToken),
    raw: payload,
  };
}

export async function validateChatgptAccessToken(
  rawAccessToken: unknown,
  options: ChatgptAccessTokenValidationOptions = {}
): Promise<ChatgptSessionValidationResult> {
  const accessToken = typeof rawAccessToken === "string" ? rawAccessToken.trim() : "";
  if (!accessToken) {
    return {
      valid: false,
      statusCode: 400,
      errorCode: "missing_access_token",
      error: "Access token is required",
      cookieNames: [],
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  let response: Response;

  try {
    response = await fetchImpl(CHATGPT_CONVERSATION_LIMIT_URL, {
      method: "GET",
      headers: {
        ...CHATGPT_WEB_HEADERS,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: options.signal,
    });
  } catch (error: unknown) {
    return {
      valid: false,
      statusCode: null,
      errorCode: "network_error",
      error: error instanceof Error ? error.message : "Failed to validate access token",
      cookieNames: [],
    };
  }

  if (!response.ok) {
    const failure = buildChatgptSessionError(response.status);
    return {
      valid: false,
      statusCode: response.status,
      errorCode: failure.errorCode,
      error: failure.error,
      cookieNames: [],
    };
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch (error: unknown) {
    return {
      valid: false,
      statusCode: response.status,
      errorCode: "invalid_session_payload",
      error:
        error instanceof Error ? error.message : "ChatGPT returned an invalid access token payload",
      cookieNames: [],
    };
  }

  const tokenContext = extractAccountContextFromAccessToken(accessToken);

  return {
    valid: true,
    statusCode: response.status,
    accessToken,
    cookieString: "",
    cookieNames: [],
    setCookieNames: [],
    session: {
      id: null,
      email: null,
      name: null,
    },
    accountId: tokenContext.accountId,
    planType: tokenContext.planType,
    expiresIn: getExpiresInSeconds({}, accessToken),
    raw: payload,
  };
}

export { CHATGPT_SESSION_URL, CHATGPT_CONVERSATION_LIMIT_URL, CHATGPT_WEB_HEADERS };
