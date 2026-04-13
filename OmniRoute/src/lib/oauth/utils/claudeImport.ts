import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { REGISTRY } from "@omniroute/open-sse/config/providerRegistry.ts";
import { refreshClaudeOAuthToken } from "@/sse/services/tokenRefresh";

const CLAUDE_IMPORT_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const CLAUDE_IMPORT_VALIDATION_TIMEOUT_MS = 10_000;
const CLAUDE_IMPORT_DEFAULT_MODEL = "claude-sonnet-4-6";

type JsonRecord = Record<string, unknown>;

export type ClaudeImportTokens = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
  subscriptionType: string | null;
  rateLimitTier: string | null;
  source: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => toNonEmptyString(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  const text = toNonEmptyString(value);
  if (!text) return [];

  return Array.from(
    new Set(
      text
        .split(/[,\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function normalizeExpiresAt(value: unknown, expiresInSeconds?: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  const numericText = toNonEmptyString(value);
  if (numericText && /^\d+$/.test(numericText)) {
    const numericValue = Number.parseInt(numericText, 10);
    if (Number.isFinite(numericValue)) {
      return numericValue > 10_000_000_000 ? numericValue : numericValue * 1000;
    }
  }

  const isoText = toNonEmptyString(value);
  if (isoText) {
    const parsed = new Date(isoText).getTime();
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  if (typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds)) {
    return Date.now() + expiresInSeconds * 1000;
  }

  const expiresInText = toNonEmptyString(expiresInSeconds);
  if (expiresInText && /^\d+$/.test(expiresInText)) {
    return Date.now() + Number.parseInt(expiresInText, 10) * 1000;
  }

  return null;
}

function normalizeClaudeImportObject(value: JsonRecord, source: string): ClaudeImportTokens {
  const nestedOauth = asRecord(value.claudeAiOauth);
  const sourceRecord = Object.keys(nestedOauth).length > 0 ? nestedOauth : value;

  const accessToken =
    toNonEmptyString(sourceRecord.accessToken) ||
    toNonEmptyString(sourceRecord.access_token) ||
    toNonEmptyString(sourceRecord.oauthToken) ||
    null;

  const refreshToken =
    toNonEmptyString(sourceRecord.refreshToken) ||
    toNonEmptyString(sourceRecord.refresh_token) ||
    null;

  if (!accessToken && !refreshToken) {
    throw new Error(
      "Missing Claude access token. Paste the full .credentials.json content or a raw access token."
    );
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: normalizeExpiresAt(sourceRecord.expiresAt, sourceRecord.expires_in),
    scopes: normalizeScopes(sourceRecord.scopes || sourceRecord.scope || ["user:inference"]),
    subscriptionType: toNonEmptyString(sourceRecord.subscriptionType),
    rateLimitTier: toNonEmptyString(sourceRecord.rateLimitTier),
    source,
  };
}

export function parseClaudeImportInput(rawInput: unknown): ClaudeImportTokens {
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      throw new Error("Claude import input is empty.");
    }

    if (trimmed.startsWith("{")) {
      try {
        return normalizeClaudeImportObject(JSON.parse(trimmed) as JsonRecord, "manual_credentials");
      } catch (error) {
        throw new Error(
          `Invalid Claude credentials JSON: ${(error as Error)?.message || "parse_failed"}`
        );
      }
    }

    return {
      accessToken: trimmed,
      refreshToken: null,
      expiresAt: null,
      scopes: ["user:inference"],
      subscriptionType: null,
      rateLimitTier: null,
      source: "manual_access_token",
    };
  }

  if (!rawInput || typeof rawInput !== "object") {
    throw new Error("Claude import input must be a JSON object or raw access token string.");
  }

  return normalizeClaudeImportObject(rawInput as JsonRecord, "manual_credentials");
}

export function getClaudeCredentialsFilePath(): string {
  const configDir =
    toNonEmptyString(process.env.CLAUDE_CONFIG_DIR) || path.join(os.homedir(), ".claude");
  return path.join(configDir, ".credentials.json");
}

export async function loadClaudeImportInputFromLocalFile(): Promise<{
  path: string;
  rawInput: string;
}> {
  const credentialsPath = getClaudeCredentialsFilePath();
  const rawInput = await fs.readFile(credentialsPath, "utf8");
  return {
    path: credentialsPath,
    rawInput,
  };
}

export async function ensureClaudeTokensUsable(
  tokens: ClaudeImportTokens
): Promise<ClaudeImportTokens> {
  const expiresSoon =
    typeof tokens.expiresAt === "number" &&
    Number.isFinite(tokens.expiresAt) &&
    tokens.expiresAt <= Date.now() + CLAUDE_IMPORT_EXPIRY_BUFFER_MS;

  if ((!tokens.accessToken || expiresSoon) && tokens.refreshToken) {
    const refreshed = await refreshClaudeOAuthToken(tokens.refreshToken);
    if (!refreshed?.accessToken) {
      throw new Error(
        "Claude refresh token is invalid or expired. Re-authenticate with Claude Code and import again."
      );
    }

    return {
      ...tokens,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || tokens.refreshToken,
      expiresAt:
        typeof refreshed.expiresIn === "number"
          ? Date.now() + refreshed.expiresIn * 1000
          : tokens.expiresAt,
    };
  }

  if (!tokens.accessToken) {
    throw new Error(
      "Claude credentials are missing an access token. Paste the full .credentials.json content instead of a partial token object."
    );
  }

  return tokens;
}

export async function validateClaudeImportAccessToken(
  accessToken: string,
  validationModelId = CLAUDE_IMPORT_DEFAULT_MODEL
): Promise<{
  valid: boolean;
  error: string | null;
  warning?: string;
  statusCode: number | null;
}> {
  const entry = REGISTRY.claude;
  const baseHeaders = asRecord(entry.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...Object.fromEntries(
      Object.entries(baseHeaders).filter(([, value]) => typeof value === "string")
    ),
    Authorization: `Bearer ${accessToken}`,
  };

  delete headers["x-api-key"];
  delete headers["X-API-Key"];

  const response = await fetch(`${entry.baseUrl}${entry.urlSuffix || ""}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: validationModelId || CLAUDE_IMPORT_DEFAULT_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "test" }],
    }),
    signal: AbortSignal.timeout(CLAUDE_IMPORT_VALIDATION_TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403) {
    return {
      valid: false,
      error: "Invalid Claude session token",
      statusCode: response.status,
    };
  }

  if (response.status === 429) {
    return {
      valid: true,
      error: null,
      warning: "Claude account is rate limited, but the imported credentials are valid.",
      statusCode: response.status,
    };
  }

  if (response.status >= 500) {
    return {
      valid: false,
      error: `Claude upstream unavailable (${response.status})`,
      statusCode: response.status,
    };
  }

  return {
    valid: true,
    error: null,
    statusCode: response.status,
  };
}
