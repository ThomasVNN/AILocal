import { NextResponse } from "next/server";
import { createProviderConnection, isCloudEnabled } from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/cloudSync";
import {
  buildGeminiWebSessionProviderData,
  validateGeminiWebSession,
} from "@omniroute/open-sse/utils/geminiWebSession.ts";

/**
 * POST /api/oauth/gemini-web2api/import
 * Import and validate Gemini Web browser headers/cookies.
 */
export async function POST(request: any) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const rawSessionInput =
      rawBody.sessionInput || rawBody.headers || rawBody.headerText || rawBody.apiKey || "";

    if (
      !(typeof rawSessionInput === "string" ? rawSessionInput.trim().length > 0 : rawSessionInput)
    ) {
      return NextResponse.json(
        {
          error:
            "Missing session input. Paste Gemini request headers, a cookie export, or a Copy as cURL capture from gemini.google.com.",
          code: "missing_session_input",
        },
        { status: 400 }
      );
    }

    const validation = await validateGeminiWebSession(rawSessionInput, {
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
      provider: "gemini-web2api",
      authType: "oauth",
      accessToken: validation.accessToken,
      refreshToken: null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      email: null,
      displayName: "Gemini Web Session",
      providerSpecificData: buildGeminiWebSessionProviderData(null, {
        sessionStatus: "active",
        authMode: validation.authMode,
        requestHeaders: validation.requestHeaders,
        authorizationHeader: validation.authorizationHeader,
        importedAt: now,
        validatedAt: now,
        refreshedAt: now,
        sessionSource: "browser_request_headers",
        models: validation.models,
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
      models: validation.models,
    });
  } catch (error: any) {
    console.log("Gemini Web2API import error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to validate Gemini Web session" },
      { status: 500 }
    );
  }
}

/**
 * Sync to Cloud if enabled
 */
async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing to cloud after Gemini Web2API import:", error);
  }
}
