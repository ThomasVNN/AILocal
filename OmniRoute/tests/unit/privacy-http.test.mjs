import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-privacy-http-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
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

test("restorePrivacyJsonResponse restores placeholders inside JSON response payloads", async () => {
  const { sanitizePrivacyPayload } = await import("../../src/lib/privacy/runtime.ts");
  const { restorePrivacyJsonResponse } = await import("../../src/lib/privacy/http.ts");

  await enableDefaultPrivacyProfile();

  const sanitized = await sanitizePrivacyPayload({
    requestId: "req-http-restore",
    payload: { messages: [{ role: "user", content: "Kiem tra OCB-PRJ-123" }] },
    sourceApp: "openwebui",
    stream: false,
  });

  const response = new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Du an [PROJECT_001] hop le" } }],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Test": "privacy-http" },
    }
  );

  const restored = await restorePrivacyJsonResponse(response, {
    requestId: "req-http-restore",
    restoreSessionId: sanitized.restoreSessionId,
    sourceApp: "openwebui",
    endpointType: "chat.completions",
  });

  const json = await restored.json();
  assert.match(json.choices[0].message.content, /OCB-PRJ-123/);
  assert.equal(restored.headers.get("X-Test"), "privacy-http");
});
