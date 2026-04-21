export const runtime = "nodejs";

import { NextResponse } from "next/server";

const MITM_DISABLED = {
  error: "mitm_disabled",
  message:
    "MITM model aliasing has been removed from LocalAgent. Use OmniRoute model IDs from /v1/models directly.",
};

function disabledResponse() {
  return NextResponse.json(MITM_DISABLED, { status: 410 });
}

export async function GET() {
  return disabledResponse();
}

export async function PUT() {
  return disabledResponse();
}
