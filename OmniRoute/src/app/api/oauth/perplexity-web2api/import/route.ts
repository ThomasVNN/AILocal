import { NextResponse } from "next/server";
import { createProviderConnection, isCloudEnabled } from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/cloudSync";
import {
  buildPerplexitySessionProviderData,
  validatePerplexitySessionCookie,
} from "@omniroute/open-sse/utils/perplexitySession.ts";

/**
 * POST /api/oauth/perplexity-web2api/import
 * Import and validate Perplexity Web session using the full browser Cookie header string.
 *
 * Request body:
 * - cookieString: string - Full Cookie header value copied from browser DevTools
 *   Must include cf_clearance, __cf_bm, __Secure-next-auth.session-token, pplx.session-id, etc.
 */
export async function POST(request: any) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Accept either `cookieString` (new full-cookie flow) or legacy `sessionCookie`
  const cookieString = (rawBody.cookieString || rawBody.sessionCookie || "").trim();

  try {
    const validation = await validatePerplexitySessionCookie(cookieString);
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

    // Save to database — store the full cookie string as accessToken
    // expiresAt is set to 20h from now (cf_clearance ~24h TTL; auto-refresh will extend it)
    const connection: any = await createProviderConnection({
      provider: "perplexity-web2api",
      authType: "oauth",
      accessToken: validation.accessToken,
      refreshToken: null,
      expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(), // 20h
      email: validation.session.email || null,
      displayName: validation.session.name || null,
      providerSpecificData: buildPerplexitySessionProviderData(null, {
        sessionStatus: "active",
        session: validation.session,
        cookieNames: validation.cookieNames,
        importedAt: now,
        validatedAt: now,
        refreshedAt: now,
        sessionSource: "browser_cookie_header",
      }),
      testStatus: "active",
    });

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        name: validation.session.name,
      },
    });
  } catch (error: any) {
    console.log("Perplexity Web2API import error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to validate cookies" },
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
    console.log("Error syncing to cloud after Perplexity import:", error);
  }
}
