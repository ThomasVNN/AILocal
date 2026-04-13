import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyInternalPrivacyRequest } from "@/lib/privacy/internalAuth";
import { sanitizePrivacyPayload } from "@/lib/privacy/runtime";

const requestSchema = z.object({
  requestId: z.string(),
  sourceApp: z.string(),
  stream: z.boolean(),
  payload: z.record(z.string(), z.any()),
  apiKeyId: z.string().nullable().optional(),
  endpointType: z.string().optional(),
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

  return NextResponse.json(await sanitizePrivacyPayload(parsed.data));
}
