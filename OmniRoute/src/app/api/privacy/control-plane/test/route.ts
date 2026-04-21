import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import { runPrivacyControlPlaneTest } from "@/lib/privacy/controlPlane";

const testSchema = z.object({
  inputMode: z.enum(["plain-text", "json"]),
  rawInput: z.string(),
  sourceApp: z.string().min(1),
  profileId: z.string().optional(),
  bundleVersion: z.string().optional(),
});

export async function POST(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({
    result: await runPrivacyControlPlaneTest(parsed.data),
  });
}
