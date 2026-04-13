import { NextResponse } from "next/server";
import { verifyInternalPrivacyRequest } from "@/lib/privacy/internalAuth";
import { getActivePrivacyBundle } from "@/lib/privacy/store";

export async function GET(request: Request) {
  const authError = await verifyInternalPrivacyRequest(request);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  const activeBundle = await getActivePrivacyBundle();
  return NextResponse.json({
    status: "ok",
    activeBundleVersion: activeBundle.version,
    internalTokenConfigured: Boolean(process.env.PRIVACY_FILTER_INTERNAL_TOKEN),
  });
}
