import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  activatePrivacyBundle,
  getActivePrivacyBundle,
  getPrivacyConfig,
  updatePrivacyConfig,
} from "@/lib/privacy/store";
import { invalidatePrivacyBundleCache } from "@/lib/privacy/bundle";

const patchSchema = z.object({
  entityTypes: z.array(z.any()).optional(),
  rules: z.array(z.any()).optional(),
  profiles: z.array(z.any()).optional(),
  documentSets: z.array(z.any()).optional(),
});

export async function GET(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const [config, activeBundle] = await Promise.all([getPrivacyConfig(), getActivePrivacyBundle()]);
  return NextResponse.json({ config, activeBundle });
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

  const config = await updatePrivacyConfig(parsed.data);
  const activeBundle = await activatePrivacyBundle({
    version: `privacy-${Date.now()}`,
    changeSummary: "Config update via dashboard API",
    compiledBundle: config,
    compiledBy: "dashboard",
  });
  invalidatePrivacyBundleCache();

  return NextResponse.json({ config, activeBundle });
}
