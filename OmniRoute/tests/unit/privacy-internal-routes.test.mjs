import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-privacy-internal-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  delete process.env.PRIVACY_FILTER_INTERNAL_TOKEN;
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  delete process.env.PRIVACY_FILTER_INTERNAL_TOKEN;
});

async function enableDefaultPrivacyProfile() {
  const { getPrivacyConfig, activatePrivacyBundle } =
    await import("../../src/lib/privacy/store.ts");
  const current = await getPrivacyConfig();

  await activatePrivacyBundle({
    version: `privacy-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    changeSummary: "Enable default privacy profile for unit tests",
    compiledBundle: {
      ...current,
      updatedAt: new Date().toISOString(),
      profiles: current.profiles.map((profile) =>
        profile.id === "default-external" ? { ...profile, enabled: true } : profile
      ),
    },
  });
}

test("internal sanitize route rejects requests without internal token when configured", async () => {
  process.env.PRIVACY_FILTER_INTERNAL_TOKEN = "privacy-internal-secret";
  const { POST } = await import("../../src/app/api/internal/privacy/sanitize/route.ts");

  const req = new Request("http://localhost/api/internal/privacy/sanitize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: "req-internal-auth",
      sourceApp: "openwebui",
      stream: false,
      payload: { messages: [{ role: "user", content: "hello" }] },
    }),
  });

  const res = await POST(req);
  assert.equal(res.status, 401);
});

test("internal sanitize route returns privacy decision when internal token is valid", async () => {
  process.env.PRIVACY_FILTER_INTERNAL_TOKEN = "privacy-internal-secret";
  const { POST } = await import("../../src/app/api/internal/privacy/sanitize/route.ts");

  await enableDefaultPrivacyProfile();

  const req = new Request("http://localhost/api/internal/privacy/sanitize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-omniroute-internal-token": "privacy-internal-secret",
    },
    body: JSON.stringify({
      requestId: "req-internal-allow",
      sourceApp: "openwebui",
      stream: false,
      payload: { messages: [{ role: "user", content: "Kiem tra OCB-PRJ-123" }] },
    }),
  });

  const res = await POST(req);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.decision, "transformed");
  assert.ok(json.restoreSessionId);
});
