import { BaseExecutor } from "./base.ts";
import { PROVIDERS } from "../config/constants.ts";
import { getAccessToken } from "../services/tokenRefresh.ts";
import { getRotatingApiKey } from "../services/apiKeyRotator.ts";
import { randomUUID } from "crypto";
import {
  buildClaudeCodeCompatibleHeaders,
  CLAUDE_CODE_COMPATIBLE_DEFAULT_CHAT_PATH,
  joinClaudeCodeCompatibleUrl,
} from "../services/claudeCodeCompatible.ts";
import { isClaudeCodeCompatible } from "../services/provider.ts";
import { normalizePerplexityWeb2ApiModel } from "../translator/helpers/perplexityWeb2ApiHelper.ts";
import { compactChatgptCookieString } from "../utils/chatgptSession.ts";
import { buildGeminiAuthorizationFromCookieHeader } from "../utils/geminiWebSession.ts";
import {
  buildClaudeWebCompletionPayload,
  buildClaudeWebRequestHeaders,
  normalizeClaudeWebModel,
  normalizeClaudeWebSessionInput,
} from "../utils/claudeWebSession.ts";

function resolveClaudeWebSession(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const rawSessionInput =
    psd.cookieString || credentials?.refreshToken || credentials?.accessToken || credentials?.apiKey;
  const normalized = normalizeClaudeWebSessionInput(rawSessionInput, {
    organizationUuid: psd.organizationUuid,
    requestHeaders: psd.requestHeaders,
  });
  if (!normalized.valid) {
    throw new Error(normalized.error);
  }
  return normalized;
}

function ensureClaudeWebConversationUuid(credentials) {
  const psd = credentials.providerSpecificData || {};
  credentials.providerSpecificData = psd;
  const existing =
    typeof psd.__claudeWebConversationUuid === "string"
      ? psd.__claudeWebConversationUuid
      : typeof psd.conversationUuid === "string"
        ? psd.conversationUuid
        : null;
  const conversationUuid = existing || randomUUID();
  psd.__claudeWebConversationUuid = conversationUuid;
  return conversationUuid;
}

export class DefaultExecutor extends BaseExecutor {
  constructor(provider) {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    void model;
    void stream;
    void urlIndex;
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const psd = credentials?.providerSpecificData;
      const baseUrl = psd?.baseUrl || "https://api.openai.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      const customPath = typeof psd?.chatPath === "string" && psd.chatPath ? psd.chatPath : null;
      if (customPath) return `${normalized}${customPath}`;
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const psd = credentials?.providerSpecificData;
      const baseUrl = psd?.baseUrl || "https://api.anthropic.com/v1";
      const customPath = typeof psd?.chatPath === "string" && psd.chatPath ? psd.chatPath : null;
      if (isClaudeCodeCompatible(this.provider)) {
        return joinClaudeCodeCompatibleUrl(
          baseUrl,
          customPath || CLAUDE_CODE_COMPATIBLE_DEFAULT_CHAT_PATH
        );
      }
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}${customPath || "/messages"}`;
    }
    switch (this.provider) {
      case "claude":
      case "glm":
      case "kimi-coding":
      case "minimax":
      case "minimax-cn":
        return `${this.config.baseUrl}?beta=true`;
      case "claudew2a": {
        if (!credentials) throw new Error("Claude Web2API credentials are required");
        const session = resolveClaudeWebSession(credentials);
        const conversationUuid = ensureClaudeWebConversationUuid(credentials);
        return `https://claude.ai/api/organizations/${session.organizationUuid}/chat_conversations/${conversationUuid}/completion`;
      }
      case "gemini":
      case "gemini-web2api":
        return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      case "qwen": {
        const resourceUrl = credentials?.providerSpecificData?.resourceUrl;
        return `https://${resourceUrl || "portal.qwen.ai"}/v1/chat/completions`;
      }
      default:
        return this.config.baseUrl;
    }
  }

  buildHeaders(credentials, stream = true) {
    const headers = { "Content-Type": "application/json", ...this.config.headers };

    // T07: resolve extra keys round-robin locally since DefaultExecutor overrides BaseExecutor buildHeaders
    const extraKeys =
      (credentials.providerSpecificData?.extraApiKeys as string[] | undefined) ?? [];
    const effectiveKey =
      extraKeys.length > 0 && credentials.connectionId && credentials.apiKey
        ? getRotatingApiKey(credentials.connectionId, credentials.apiKey, extraKeys)
        : credentials.apiKey;

    switch (this.provider) {
      case "gemini": {
        const maybeAccessTokenKey =
          typeof credentials.accessToken === "string" ? credentials.accessToken.trim() : "";
        const accessTokenLooksLikeApiKey =
          maybeAccessTokenKey.startsWith("AIza") || maybeAccessTokenKey.startsWith("secretref-");
        const keyCandidate =
          effectiveKey || credentials.apiKey || (accessTokenLooksLikeApiKey ? maybeAccessTokenKey : null);
        if (typeof keyCandidate === "string" && keyCandidate.trim().length > 0) {
          headers["x-goog-api-key"] = keyCandidate.trim();
        }
        break;
      }
      case "gemini-web2api": {
        const providerHeaders =
          credentials.providerSpecificData &&
          typeof credentials.providerSpecificData === "object" &&
          credentials.providerSpecificData.requestHeaders &&
          typeof credentials.providerSpecificData.requestHeaders === "object" &&
          !Array.isArray(credentials.providerSpecificData.requestHeaders)
            ? credentials.providerSpecificData.requestHeaders
            : {};

        for (const [name, value] of Object.entries(providerHeaders)) {
          if (typeof value !== "string" || !value.trim()) continue;
          headers[name] = value.trim();
        }

        const providerAuthorization =
          typeof credentials.providerSpecificData?.authorizationHeader === "string" &&
          credentials.providerSpecificData.authorizationHeader.trim().length > 0
            ? credentials.providerSpecificData.authorizationHeader.trim()
            : null;
        const accessTokenAuthorization =
          typeof credentials.accessToken === "string" && credentials.accessToken.trim().length > 0
            ? credentials.accessToken.trim()
            : null;

        const providerCookie =
          typeof headers.Cookie === "string" && headers.Cookie.trim().length > 0
            ? headers.Cookie.trim()
            : typeof headers.cookie === "string" && headers.cookie.trim().length > 0
              ? headers.cookie.trim()
              : null;

        const shouldRefreshSapisidHash =
          !providerAuthorization || /^sapisid(?:1p|3p)?hash\s+/i.test(providerAuthorization);
        const derivedCookieAuthorization =
          providerCookie && shouldRefreshSapisidHash
            ? buildGeminiAuthorizationFromCookieHeader(providerCookie)
            : null;

        if (derivedCookieAuthorization) {
          headers["Authorization"] = derivedCookieAuthorization;
        } else if (providerAuthorization) {
          headers["Authorization"] = providerAuthorization;
        } else if (
          accessTokenAuthorization &&
          (/^bearer\s+/i.test(accessTokenAuthorization) ||
            /^sapisid(?:1p|3p)?hash\s+/i.test(accessTokenAuthorization))
        ) {
          headers["Authorization"] = accessTokenAuthorization;
        }
        break;
      }
      case "claude":
        effectiveKey
          ? (headers["x-api-key"] = effectiveKey)
          : (headers["Authorization"] = `Bearer ${credentials.accessToken}`);
        break;
      case "glm":
      case "kimi-coding":
      case "bailian-coding-plan":
      case "kimi-coding-apikey":
      case "minimax":
      case "minimax-cn":
        headers["x-api-key"] = effectiveKey || credentials.accessToken;
        break;
      // ChatGPT Web2API uses a browser session:
      // - Authorization: Bearer <session accessToken> (from /api/auth/session)
      // - Cookie: full browser cookie string for anti-bot/session continuity
      case "chatgpt-web2api": {
        const bearerToken = credentials.accessToken || credentials.apiKey;
        if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;

        const cookieStr =
          credentials.providerSpecificData?.cookieString ||
          credentials.refreshToken ||
          credentials.apiKey;
        if (cookieStr) {
          const compactCookie = compactChatgptCookieString(cookieStr);
          // Prevent oversized cookie header errors (431); bearer token remains primary auth.
          if (compactCookie && compactCookie.length <= 3800) {
            headers["Cookie"] = compactCookie;
          }
        }

        const workspaceId = credentials.providerSpecificData?.workspaceId;
        if (workspaceId) {
          headers["chatgpt-account-id"] = workspaceId;
        }

        headers["User-Agent"] =
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
        headers["Accept-Language"] = "en-US,en;q=0.9";
        headers["Origin"] = "https://chatgpt.com";
        headers["Referer"] = "https://chatgpt.com/";
        break;
      }
      // Perplexity Web2API uses a full browser Cookie string for auth (bypasses Cloudflare)
      case "perplexity-web2api": {
        const cookieStr = credentials.accessToken || credentials.apiKey;
        if (cookieStr) headers["Cookie"] = cookieStr;
        // Anti-bot headers are strictly required by Cloudflare
        headers["User-Agent"] =
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
        headers["Accept-Language"] = "en-US,en;q=0.9";
        headers["Origin"] = "https://www.perplexity.ai";
        headers["Referer"] = "https://www.perplexity.ai/";
        // Remove any Authorization header that base class may have set
        delete headers["Authorization"];
        break;
      }
      case "claudew2a": {
        const session = resolveClaudeWebSession(credentials);
        const requestHeaders =
          credentials.providerSpecificData?.requestHeaders &&
          typeof credentials.providerSpecificData.requestHeaders === "object"
            ? credentials.providerSpecificData.requestHeaders
            : session.requestHeaders;
        const claudeHeaders = buildClaudeWebRequestHeaders({
          cookieString: session.cookieString,
          organizationUuid: session.organizationUuid,
          requestHeaders: {
            ...session.requestHeaders,
            ...requestHeaders,
          },
          accept: stream ? "text/event-stream" : "application/json",
        });
        for (const key of Object.keys(headers)) delete headers[key];
        Object.assign(headers, claudeHeaders);
        break;
      }
      default:
        if (isClaudeCodeCompatible(this.provider)) {
          return buildClaudeCodeCompatibleHeaders(
            effectiveKey || credentials.accessToken || "",
            stream,
            credentials?.providerSpecificData?.ccSessionId
          );
        }
        if (this.provider?.startsWith?.("anthropic-compatible-")) {
          if (effectiveKey) {
            headers["x-api-key"] = effectiveKey;
          } else if (credentials.accessToken) {
            headers["Authorization"] = `Bearer ${credentials.accessToken}`;
          }
          if (!headers["anthropic-version"]) {
            headers["anthropic-version"] = "2023-06-01";
          }
        } else {
          headers["Authorization"] = `Bearer ${effectiveKey || credentials.accessToken}`;
        }
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  /**
   * For compatible providers, the model name is already clean by the time
   * it reaches the executor (chatCore sets body.model = modelInfo.model,
   * which is the parsed model ID without internal routing prefixes).
   *
   * Models may legitimately contain "/" as part of their ID (e.g. "zai-org/GLM-5-FP8",
   * "org/model-name") — we must NOT strip path segments. (Fix #493)
   */
  transformRequest(model, body, stream, credentials) {
    void stream;
    void credentials;

    if (this.provider === "perplexity-web2api" && body && typeof body === "object") {
      const transformed = { ...body };
      const currentParams =
        transformed.params &&
        typeof transformed.params === "object" &&
        !Array.isArray(transformed.params)
          ? transformed.params
          : {};

      delete transformed.model;
      delete transformed.messages;
      delete transformed.stream;

      transformed.params = {
        attachments: [],
        query_source: "home",
        ...currentParams,
        model_preference: normalizePerplexityWeb2ApiModel(model),
      };

      return transformed;
    }

    if (this.provider === "claudew2a" && body && typeof body === "object") {
      const psd = credentials.providerSpecificData || {};
      credentials.providerSpecificData = psd;
      const conversationUuid =
        typeof psd.__claudeWebConversationUuid === "string"
          ? psd.__claudeWebConversationUuid
          : ensureClaudeWebConversationUuid(credentials);
      resolveClaudeWebSession(credentials);

      return buildClaudeWebCompletionPayload({
        model: normalizeClaudeWebModel(model),
        body: body as Record<string, unknown>,
        conversationUuid,
        timezone: typeof psd.timezone === "string" ? psd.timezone : null,
        locale: typeof psd.locale === "string" ? psd.locale : null,
        temporary: psd.temporaryConversations === true,
      });
    }

    return body;
  }

  /**
   * Refresh credentials via the centralized tokenRefresh service.
   * Delegates to getAccessToken() which handles all providers with
   * race-condition protection (deduplication via refreshPromiseCache).
   */
  async refreshCredentials(credentials, log) {
    if (!credentials.refreshToken) return null;
    try {
      return await getAccessToken(this.provider, credentials, log);
    } catch (error) {
      log?.error?.("TOKEN", `${this.provider} refresh error: ${error.message}`);
      return null;
    }
  }
}

export default DefaultExecutor;
