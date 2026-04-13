import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-privacy-config-"));
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

test("privacy store seeds default config and active bundle", async () => {
  const { getPrivacyConfig, getActivePrivacyBundle } =
    await import("../../src/lib/privacy/store.ts");

  const config = await getPrivacyConfig();
  const activeBundle = await getActivePrivacyBundle();

  assert.ok(Array.isArray(config.entityTypes));
  assert.ok(Array.isArray(config.rules));
  assert.ok(Array.isArray(config.profiles));
  assert.ok(Array.isArray(config.documentSets));
  assert.ok(config.entityTypes.length > 0);
  assert.ok(config.rules.length > 0);
  assert.ok(config.profiles.length > 0);
  assert.ok(activeBundle);
  assert.equal(activeBundle.status, "active");
});

test("privacy store persists config updates and bundle activation", async () => {
  const { getPrivacyConfig, updatePrivacyConfig, activatePrivacyBundle, getActivePrivacyBundle } =
    await import("../../src/lib/privacy/store.ts");

  const current = await getPrivacyConfig();
  const updated = await updatePrivacyConfig({
    profiles: [
      ...current.profiles,
      {
        id: "strict-default",
        name: "Strict Default",
        enabled: true,
        appliesTo: { sourceApps: ["openwebui"] },
        levelOverrides: {},
        transformOverrides: {},
        restorePolicy: {
          allowRestore: true,
          requireFullRestore: true,
          allowStreamingPlaceholderPassthrough: false,
        },
        fallbackMode: "block",
      },
    ],
  });

  assert.ok(updated.profiles.some((profile) => profile.id === "strict-default"));

  const activated = await activatePrivacyBundle({
    version: "privacy-test-bundle",
    changeSummary: "unit-test activation",
  });
  const active = await getActivePrivacyBundle();

  assert.equal(activated.version, "privacy-test-bundle");
  assert.equal(active.version, "privacy-test-bundle");
  assert.equal(active.status, "active");
});
