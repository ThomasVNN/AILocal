import { NextResponse } from "next/server";
import { createProviderConnection, isCloudEnabled } from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/cloudSync";
import {
  buildChatgptSessionProviderData,
  validateChatgptSessionCookie,
  validateChatgptSessionPayload,
} from "@omniroute/open-sse/utils/chatgptSession.ts";

/**
 * POST /api/oauth/chatgpt-web2api/import
 * Import and validate ChatGPT web session using the browser Cookie header or /api/auth/session JSON.
 */
export async function POST(request: any) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const rawSessionPayload = rawBody.sessionPayload || rawBody.sessionJson || rawBody.session;
    let validation;
    let sessionSource = "browser_cookie_header";

    if (rawSessionPayload) {
      let parsedPayload = rawSessionPayload;
      if (typeof rawSessionPayload === "string") {
        try {
          parsedPayload = JSON.parse(rawSessionPayload);
        } catch {
          return NextResponse.json({ error: "Invalid session JSON" }, { status: 400 });
        }
      }

      validation = await validateChatgptSessionPayload(parsedPayload, {
        allowBareSessionToken: true,
      });
      sessionSource = "browser_session_payload";
    } else {
      // Accept either `cookieString` (new full-cookie flow) or legacy `sessionCookie`
      const cookieString = (rawBody.cookieString || rawBody.sessionCookie || "").trim();
      if (!cookieString) {
        return NextResponse.json(
          {
            error:
              "Missing cookie input. Paste Cookie header value, JSON cookie export, or session payload JSON.",
            code: "missing_cookie",
          },
          { status: 400 }
        );
      }

      const looksLikeCookiePairs = cookieString.includes("=");
      const looksLikeJsonCookieExport =
        cookieString.startsWith("[") ||
        (cookieString.startsWith("{") && /"cookies"\s*:/.test(cookieString));
      if (!looksLikeCookiePairs && !looksLikeJsonCookieExport) {
        return NextResponse.json(
          {
            error:
              "Invalid cookie format. Paste Cookie header value (name=value; ...) or JSON cookie export array.",
            code: "invalid_cookie_format",
          },
          { status: 400 }
        );
      }

      validation = await validateChatgptSessionCookie(cookieString, {
        allowBareSessionToken: true,
      });
    }

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
    const expiresIn = Math.max(60, validation.expiresIn || 30 * 60);

    const connection: any = await createProviderConnection({
      provider: "chatgpt-web2api",
      authType: "oauth",
      accessToken: validation.accessToken,
      // Persist full browser cookie string as refresh credential for future session revalidation.
      refreshToken: validation.cookieString,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      email: validation.session.email || null,
      displayName: validation.session.name || null,
      providerSpecificData: buildChatgptSessionProviderData(null, {
        sessionStatus: "active",
        session: validation.session,
        cookieNames: validation.cookieNames,
        cookieString: validation.cookieString,
        accountId: validation.accountId,
        planType: validation.planType,
        importedAt: now,
        validatedAt: now,
        refreshedAt: now,
        sessionSource,
      }),
      testStatus: "active",
    });

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
    console.log("ChatGPT Web2API import error:", error);
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
    console.log("Error syncing to cloud after ChatGPT import:", error);
  }
}
