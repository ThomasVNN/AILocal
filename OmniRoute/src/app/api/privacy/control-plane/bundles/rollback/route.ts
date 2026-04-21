import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import { getPrivacyControlPlaneWorkspace, rollbackPrivacyBundle } from "@/lib/privacy/controlPlane";

const rollbackSchema = z.object({
  version: z.string().min(1),
});

export async function POST(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = rollbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const activeBundle = await rollbackPrivacyBundle({
    version: parsed.data.version,
    actor: "dashboard",
  });

  return NextResponse.json({
    activeBundle,
    workspace: await getPrivacyControlPlaneWorkspace(),
  });
}
