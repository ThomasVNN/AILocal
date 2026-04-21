import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("LocalAgent dashboard default brand is AIAgentGateway", async () => {
  const { APP_CONFIG } = await import("../../src/shared/constants/config.ts");

  assert.equal(APP_CONFIG.name, "AIAgentGateway");
});

test("LocalAgent system version does not advertise upstream npm updates", async () => {
  const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-gateway-version-"));
  process.env.DATA_DIR = testDataDir;

  const core = await import("../../src/lib/db/core.ts");
  const route = await import("../../src/app/api/system/version/route.ts");

  try {
    const response = await route.GET(new Request("http://localhost/api/system/version"));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.updateAvailable, false);
    assert.equal(payload.latest, payload.current);
    assert.equal(payload.autoUpdateSupported, false);
    assert.match(payload.autoUpdateError, /LocalAgent/i);
  } finally {
    core.resetDbInstance();
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});
