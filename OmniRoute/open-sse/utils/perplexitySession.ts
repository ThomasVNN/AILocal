const PERPLEXITY_SESSION_URL = "https://www.perplexity.ai/api/auth/session";
const PERPLEXITY_WEB_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  Origin: "https://www.perplexity.ai",
  Referer: "https://www.perplexity.ai/",
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

type PerplexitySessionValidationOptions = CookieNormalizationOptions & {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

type PerplexitySessionUser = {
  id: string | null;
  email: string | null;
  name: string | null;
};

type PerplexitySessionValidationResult =
  | {
      valid: true;
      statusCode: number;
      accessToken: string;
      cookieNames: string[];
      setCookieNames: string[];
      session: PerplexitySessionUser;
      raw: Record<string, unknown>;
    }
  | {
      valid: false;
      statusCode: number | null;
      errorCode: string;
      error: string;
      cookieNames: string[];
    };

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

function toNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

export function normalizePerplexityCookieString(
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

export function mergePerplexityCookieHeaders(
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

function buildPerplexitySessionError(statusCode: number | null, responseBody: string) {
  const body = responseBody.toLowerCase();

  if (statusCode === 401) {
    return {
      errorCode: "session_expired",
      error: "Session expired or invalid — reconnect via dashboard",
    };
  }

  if (statusCode === 403) {
    if (body.includes("cloudflare") || body.includes("cf_chl") || body.includes("challenge")) {
      return {
        errorCode: "cloudflare_blocked",
        error:
          "Cloudflare blocked the request (403). Copy the full Cookie header from browser DevTools, including cf_clearance.",
      };
    }

    return {
      errorCode: "session_forbidden",
      error: "Session invalid or forbidden — please reconnect with fresh cookies",
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
      ? `Perplexity session check returned ${statusCode}`
      : "Session validation failed",
  };
}

export function buildPerplexitySessionProviderData(
  existing: Record<string, unknown> | null | undefined,
  update: {
    sessionStatus: string;
    session?: PerplexitySessionUser | null;
    cookieNames?: string[];
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
    cookieNames:
      Array.isArray(update.cookieNames) && update.cookieNames.length > 0
        ? update.cookieNames
        : Array.isArray(current.cookieNames)
          ? current.cookieNames
          : [],
    sessionUserId: session?.id || toNullableString(current.sessionUserId),
    sessionEmail: session?.email || toNullableString(current.sessionEmail),
    sessionName: session?.name || toNullableString(current.sessionName),
  };
}

export async function validatePerplexitySessionCookie(
  rawCookieString: unknown,
  options: PerplexitySessionValidationOptions = {}
): Promise<PerplexitySessionValidationResult> {
  const normalized = normalizePerplexityCookieString(rawCookieString, options);
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

  try {
    response = await fetchImpl(PERPLEXITY_SESSION_URL, {
      method: "GET",
      headers: {
        ...PERPLEXITY_WEB_HEADERS,
        Cookie: normalized.cookieString,
      },
      signal: options.signal,
    });
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
    const responseBody = await response.text().catch(() => "");
    const failure = buildPerplexitySessionError(response.status, responseBody);
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
      error:
        error instanceof Error ? error.message : "Perplexity returned an invalid session payload",
      cookieNames: normalized.cookieNames,
    };
  }

  if (!payload?.user) {
    return {
      valid: false,
      statusCode: response.status,
      errorCode: "session_missing_user",
      error: "Cookie valid but no user data found — session may have expired",
      cookieNames: normalized.cookieNames,
    };
  }

  const mergedCookies = mergePerplexityCookieHeaders(
    normalized.cookieString,
    getSetCookieHeaders(response.headers)
  );

  return {
    valid: true,
    statusCode: response.status,
    accessToken: mergedCookies.cookieString,
    cookieNames: mergedCookies.cookieNames,
    setCookieNames: mergedCookies.setCookieNames,
    session: {
      id: toNullableString(payload.user.id),
      email: toNullableString(payload.user.email),
      name: toNullableString(payload.user.name),
    },
    raw: payload,
  };
}

export { PERPLEXITY_SESSION_URL, PERPLEXITY_WEB_HEADERS };
