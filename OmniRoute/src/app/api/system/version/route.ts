/**
 * GET  /api/system/version  - Returns the current LocalAgent source-built app version.
 * POST /api/system/version  - Disabled for LocalAgent source-built deployments.
 *
 * Security: Requires admin authentication (same as other management routes).
 * Safety: LocalAgent updates are handled through deploy/ops flows, not upstream npm banners.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import pkg from "../../../../../package.json" with { type: "json" };

export const dynamic = "force-dynamic";

const LOCALAGENT_UPDATE_DISABLED_REASON =
  "LocalAgent source-built deployments are updated through LocalAgent deploy flows, not upstream npm releases.";

function getCurrentVersion(): string {
  return typeof pkg.version === "string" ? pkg.version : "unknown";
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const current = getCurrentVersion();
  return NextResponse.json({
    current,
    latest: current,
    updateAvailable: false,
    channel: "localagent-source",
    autoUpdateSupported: false,
    autoUpdateError: LOCALAGENT_UPDATE_DISABLED_REASON,
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const current = getCurrentVersion();
  return NextResponse.json(
    {
      success: false,
      error: LOCALAGENT_UPDATE_DISABLED_REASON,
      current,
      latest: current,
      updateAvailable: false,
    },
    { status: 400 }
  );
}
