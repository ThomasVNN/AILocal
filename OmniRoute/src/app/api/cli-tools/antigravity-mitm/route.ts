export const runtime = "nodejs";

import { NextResponse } from "next/server";
<<<<<<< HEAD
=======
import { cliMitmStartSchema, cliMitmStopSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { resolveApiKey } from "@/shared/services/apiKeyResolver";
>>>>>>> 08d0e9f8b4e412fea54cb5999c022bd368bfb9cd

const MITM_DISABLED = {
  error: "mitm_disabled",
  message:
    "MITM interception has been removed from LocalAgent. Configure Antigravity with the OmniRoute OpenAI-compatible base URL and a Bearer API key instead.",
  baseUrl: "https://router.localagent.local:8443/v1",
};

function disabledResponse() {
  return NextResponse.json(MITM_DISABLED, { status: 410 });
}

export async function GET() {
  return disabledResponse();
}

<<<<<<< HEAD
export async function POST() {
  return disabledResponse();
=======
// POST - Start MITM proxy
export async function POST(request) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "Invalid request",
          details: [{ field: "body", message: "Invalid JSON body" }],
        },
      },
      { status: 400 }
    );
  }

  try {
    const validation = validateBody(cliMitmStartSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { apiKey: rawApiKey, sudoPassword } = validation.data;
    // (#523) Extract keyId BEFORE validation — Zod strips unknown fields!
    const apiKeyId = typeof rawBody?.keyId === "string" ? rawBody.keyId.trim() : null;
    const apiKey = await resolveApiKey(apiKeyId, rawApiKey);
    const { startMitm, getCachedPassword, setCachedPassword } = await import("@/mitm/manager");
    const isWin = process.platform === "win32";
    const pwd = sudoPassword || getCachedPassword() || "";

    if (!apiKey || (!isWin && !pwd)) {
      return NextResponse.json(
        { error: isWin ? "Missing apiKey" : "Missing apiKey or sudoPassword" },
        { status: 400 }
      );
    }

    const result = await startMitm(apiKey, pwd);
    if (!isWin) setCachedPassword(pwd);

    return NextResponse.json({
      success: true,
      running: result.running,
      pid: result.pid,
    });
  } catch (error) {
    console.log("Error starting MITM:", error.message);
    return NextResponse.json(
      { error: error.message || "Failed to start MITM proxy" },
      { status: 500 }
    );
  }
>>>>>>> 08d0e9f8b4e412fea54cb5999c022bd368bfb9cd
}

export async function DELETE() {
  return disabledResponse();
}
