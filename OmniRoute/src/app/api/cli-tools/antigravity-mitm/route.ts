export const runtime = "nodejs";

import { NextResponse } from "next/server";

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

export async function POST() {
  return disabledResponse();
}

export async function DELETE() {
  return disabledResponse();
}
