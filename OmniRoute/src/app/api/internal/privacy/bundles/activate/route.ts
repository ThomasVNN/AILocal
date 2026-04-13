import { NextResponse } from "next/server";
import { z } from "zod";
import { activatePrivacyBundle, getPrivacyConfig } from "@/lib/privacy/store";
import { invalidatePrivacyBundleCache } from "@/lib/privacy/bundle";
import { verifyInternalPrivacyRequest } from "@/lib/privacy/internalAuth";

const requestSchema = z.object({
  version: z.string(),
  changeSummary: z.string().optional(),
});

export async function POST(request: Request) {
  const authError = await verifyInternalPrivacyRequest(request);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const config = await getPrivacyConfig();
  const activeBundle = await activatePrivacyBundle({
    version: parsed.data.version,
    changeSummary: parsed.data.changeSummary,
    compiledBundle: config,
    compiledBy: "internal-api",
  });
  invalidatePrivacyBundleCache();
  return NextResponse.json(activeBundle);
}
