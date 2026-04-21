import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  getPrivacyControlPlaneWorkspace,
  publishPrivacyDraftBundle,
} from "@/lib/privacy/controlPlane";

const publishSchema = z.object({
  notes: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = publishSchema.safeParse(body || {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const activeBundle = await publishPrivacyDraftBundle({
    notes: parsed.data.notes,
    actor: "dashboard",
  });

  return NextResponse.json({
    activeBundle,
    workspace: await getPrivacyControlPlaneWorkspace(),
  });
}
