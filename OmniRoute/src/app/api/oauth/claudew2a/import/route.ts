import { NextResponse } from "next/server";
import { createProviderConnection, isCloudEnabled } from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/cloudSync";
import {
  buildClaudeWebSessionProviderData,
  validateClaudeWebSession,
} from "@omniroute/open-sse/utils/claudeWebSession.ts";

/**
 * POST /api/oauth/claudew2a/import
 * Import and validate a Claude Web browser session from a claude.ai request capture.
 */
export async function POST(request: any) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const sessionInput =
      rawBody.sessionInput || rawBody.headers || rawBody.headerText || rawBody.cookieString || "";

    if (!(typeof sessionInput === "string" && sessionInput.trim().length > 0)) {
      return NextResponse.json(
        {
          error:
            "Missing session input. Paste a Claude request header capture, Copy as cURL, Cookie header, or JSON cookie export.",
          code: "missing_session_input",
        },
        { status: 400 }
      );
    }

    const validation = await validateClaudeWebSession(sessionInput, {
      organizationUuid:
        typeof rawBody.organizationUuid === "string" ? rawBody.organizationUuid.trim() : null,
      signal: AbortSignal.timeout(10_000),
    });

    if (!validation.valid) {
      const status =
        validation.statusCode === 400
          ? 400
          : validation.statusCode === 401 || validation.statusCode === 403
            ? 401
            : 502;

      return NextResponse.json(
        {
          error: validation.error,
          code: validation.errorCode,
        },
        { status }
      );
    }

    const now = new Date().toISOString();
    const connection: any = await createProviderConnection({
      provider: "claudew2a",
      authType: "oauth",
      accessToken: validation.cookieString,
      refreshToken: null,
      expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
      email: null,
      displayName: "Claude Web Session",
      providerSpecificData: buildClaudeWebSessionProviderData(null, {
        sessionStatus: "active",
        organizationUuid: validation.organizationUuid,
        cookieNames: validation.cookieNames,
        requestHeaders: validation.requestHeaders,
        importedAt: now,
        validatedAt: now,
        refreshedAt: now,
        sessionSource: "browser_request_capture",
      }),
      testStatus: "active",
    });

    await syncToCloudIfEnabled();

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        name: connection.displayName,
      },
      organizationUuid: validation.organizationUuid,
    });
  } catch (error: any) {
    console.log("Claude Web2API import error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to validate Claude Web session" },
      { status: 500 }
    );
  }
}

async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing to cloud after Claude Web2API import:", error);
  }
}
