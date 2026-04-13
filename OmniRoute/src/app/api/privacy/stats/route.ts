import { NextResponse } from "next/server";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import { getActivePrivacyBundle, getPrivacyRuntimeStats } from "@/lib/privacy/store";

export async function GET(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
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
