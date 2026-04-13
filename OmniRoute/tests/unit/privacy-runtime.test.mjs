import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-privacy-runtime-"));
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
    changeSummary: "Enable default privacy profile for runtime tests",
    compiledBundle: {
      ...current,
      updatedAt: new Date().toISOString(),
      profiles: current.profiles.map((profile) =>
        profile.id === "default-external" ? { ...profile, enabled: true } : profile
      ),
    },
  });
}

test("privacy runtime is pass-through when no privacy profile is active", async () => {
  const { sanitizePrivacyPayload } = await import("../../src/lib/privacy/runtime.ts");

  const result = await sanitizePrivacyPayload({
    requestId: "req-pass-through",
    payload: {
      messages: [{ role: "user", content: "Lien he Nguyen Van A qua email nguyen@example.com" }],
    },
    sourceApp: "openwebui",
    stream: false,
  });

  assert.equal(result.decision, "allow");
  assert.equal(result.restoreSessionId, null);
  assert.equal(
    result.sanitizedPayload.messages[0].content,
    "Lien he Nguyen Van A qua email nguyen@example.com"
  );
});

test("privacy runtime blocks level-1 bank account content", async () => {
  const { sanitizePrivacyPayload } = await import("../../src/lib/privacy/runtime.ts");

  await enableDefaultPrivacyProfile();

  const result = await sanitizePrivacyPayload({
    requestId: "req-block",
    payload: {
      messages: [{ role: "user", content: "So tai khoan 1234567890123 cua toi dang bi loi" }],
    },
    sourceApp: "openwebui",
    stream: false,
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.restoreSessionId, null);
  assert.ok(result.entitySummary.blockedCount > 0);
});

test("privacy runtime masks level-2 customer details and tokenizes level-3 internal ids", async () => {
  const { sanitizePrivacyPayload } = await import("../../src/lib/privacy/runtime.ts");

  await enableDefaultPrivacyProfile();

  const result = await sanitizePrivacyPayload({
    requestId: "req-transform",
    payload: {
      messages: [
        {
          role: "user",
          content: "Lien he Nguyen Van A qua email nguyen@example.com va kiem tra OCB-PRJ-123",
        },
      ],
    },
    sourceApp: "openclaw-gw",
    stream: false,
  });

  assert.equal(result.decision, "transformed");
  assert.ok(result.restoreSessionId);
  assert.match(result.sanitizedPayload.messages[0].content, /\[PROJECT_001\]/);
  assert.match(result.sanitizedPayload.messages[0].content, /\[EMAIL_MASKED\]/);
  assert.match(result.sanitizedPayload.messages[0].content, /\[PERSON_MASKED\]/);
});

test("privacy runtime restores placeholders in non-streaming responses", async () => {
  const { sanitizePrivacyPayload, restorePrivacyPayload } =
    await import("../../src/lib/privacy/runtime.ts");

  await enableDefaultPrivacyProfile();

  const sanitized = await sanitizePrivacyPayload({
    requestId: "req-restore",
    payload: {
      messages: [{ role: "user", content: "Cho toi thong tin OCB-PRJ-123" }],
    },
    sourceApp: "openwebui",
    stream: false,
  });

  assert.equal(sanitized.decision, "transformed");
  assert.ok(sanitized.restoreSessionId);

  const restored = await restorePrivacyPayload({
    requestId: "req-restore",
    restoreSessionId: sanitized.restoreSessionId,
    sourceApp: "openwebui",
    endpointType: "chat.completions",
    stream: false,
    payload: {
      choices: [
        {
          message: {
            role: "assistant",
            content: "Da xac minh [PROJECT_001] trong he thong noi bo",
          },
        },
      ],
    },
  });

  assert.match(restored.restoredPayload.choices[0].message.content, /OCB-PRJ-123/);
  assert.equal(restored.restoreSummary.restoredCount, 1);
});
