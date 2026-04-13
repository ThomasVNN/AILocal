import { NextResponse } from "next/server";
import { createProviderConnection, isCloudEnabled } from "@/models";
import { syncToCloud } from "@/lib/cloudSync";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import {
  ensureClaudeTokensUsable,
  loadClaudeImportInputFromLocalFile,
  parseClaudeImportInput,
  validateClaudeImportAccessToken,
} from "@/lib/oauth/utils/claudeImport";

/**
 * POST /api/oauth/claude/import
 * Import Claude Code / Claude.ai OAuth credentials into the existing Claude provider.
 *
 * Supported inputs:
 * - { source: "local_file" } → read ~/.claude/.credentials.json on the OmniRoute host
 * - { credentialsInput: "<full .credentials.json contents>" }
 * - { credentialsInput: "<raw access token>" }
 * - { credentialsInput: { claudeAiOauth: {...} } }
 */
export async function POST(request: Request) {
  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const wantsLocalFile = rawBody.source === "local_file";
    const localFile = wantsLocalFile ? await loadClaudeImportInputFromLocalFile() : null;
    const rawInput =
      localFile?.rawInput ||
      rawBody.credentialsInput ||
      rawBody.credentialsJson ||
      rawBody.accessToken ||
      null;

    if (!rawInput) {
      return NextResponse.json(
        {
          error:
            "Missing Claude credentials input. Paste the full ~/.claude/.credentials.json content, a raw access token, or use source=local_file.",
          code: "missing_credentials_input",
        },
        { status: 400 }
      );
    }

    const parsedTokens = parseClaudeImportInput(rawInput);
    const usableTokens = await ensureClaudeTokensUsable(parsedTokens);

    const validationModelId =
      typeof rawBody.validationModelId === "string" ? rawBody.validationModelId.trim() : "";
    const validation = await validateClaudeImportAccessToken(
      usableTokens.accessToken || "",
      validationModelId || undefined
    );

    if (!validation.valid) {
      const status =
        validation.statusCode === 401 || validation.statusCode === 403
          ? 401
          : validation.statusCode && validation.statusCode >= 500
            ? 502
            : 400;

      return NextResponse.json(
        {
          error: validation.error || "Claude credential validation failed",
          code: "invalid_claude_credentials",
        },
        { status }
      );
    }

    const now = new Date().toISOString();
    const displayName =
      typeof rawBody.displayName === "string" && rawBody.displayName.trim()
        ? rawBody.displayName.trim()
        : usableTokens.subscriptionType
          ? `Claude Code (${usableTokens.subscriptionType})`
          : "Claude Code (Imported)";

    const connection: any = await createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: usableTokens.accessToken,
      refreshToken: usableTokens.refreshToken,
      expiresAt: usableTokens.expiresAt ? new Date(usableTokens.expiresAt).toISOString() : null,
      email: null,
      displayName,
      providerSpecificData: {
        authMethod: "claude_code_import",
        sessionStatus: "active",
        sessionSource: wantsLocalFile && localFile ? "local_credentials_file" : usableTokens.source,
        scopes: usableTokens.scopes,
        subscriptionType: usableTokens.subscriptionType,
        rateLimitTier: usableTokens.rateLimitTier,
        importedAt: now,
        validatedAt: now,
        credentialsPath: wantsLocalFile ? localFile?.path || null : null,
      },
      testStatus: "active",
    });

    await syncToCloudIfEnabled();

    return NextResponse.json({
      success: true,
      warning: validation.warning || null,
      connection: {
        id: connection.id,
        provider: connection.provider,
        name: connection.displayName,
        source: wantsLocalFile ? localFile?.path || "local_credentials_file" : usableTokens.source,
      },
    });
  } catch (error: any) {
    const message = error?.message || "Failed to import Claude credentials";
    const status =
      String(message).includes(".credentials.json") || String(message).includes("Missing Claude")
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing to cloud after Claude import:", error);
  }
}
