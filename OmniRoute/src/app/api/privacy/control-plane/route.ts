import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  getPrivacyControlPlaneWorkspace,
  patchPrivacyControlPlane,
} from "@/lib/privacy/controlPlane";

const settingsSchema = z
  .object({
    vaultEnabled: z.boolean().optional(),
    tokenTtlSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
    autoExpireRestoreTokens: z.boolean().optional(),
    encryptionRequired: z.boolean().optional(),
    keyRotationDays: z.number().int().min(1).max(365).optional(),
    validatorMode: z.enum(["strict", "balanced", "observe"]).optional(),
    fallbackToLocalLlm: z.boolean().optional(),
    auditRetentionDays: z.number().int().min(1).max(3650).optional(),
    publishRestrictedToAdmins: z.boolean().optional(),
  })
  .optional();

const patchSchema = z.object({
  entityTypes: z.array(z.any()).optional(),
  rules: z.array(z.any()).optional(),
  profiles: z.array(z.any()).optional(),
  documentSets: z.array(z.any()).optional(),
  settings: settingsSchema,
});

export async function GET(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  return NextResponse.json(await getPrivacyControlPlaneWorkspace());
}

export async function PATCH(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json(await patchPrivacyControlPlane(parsed.data));
}
