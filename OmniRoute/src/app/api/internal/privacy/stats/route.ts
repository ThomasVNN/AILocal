import { NextResponse } from "next/server";
import { verifyInternalPrivacyRequest } from "@/lib/privacy/internalAuth";
import { getActivePrivacyBundle, getPrivacyRuntimeStats } from "@/lib/privacy/store";

export async function GET(request: Request) {
  const authError = await verifyInternalPrivacyRequest(request);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  const [stats, activeBundle] = await Promise.all([
    getPrivacyRuntimeStats(),
    getActivePrivacyBundle(),
  ]);
  return NextResponse.json({
    ...stats,
    activeBundle,
  });
}
