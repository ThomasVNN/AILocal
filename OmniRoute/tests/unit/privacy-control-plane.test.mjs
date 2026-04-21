import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-privacy-cp-"));
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

async function enableDefaultProfile() {
  const { getPrivacyConfig, updatePrivacyConfig, activatePrivacyBundle } =
    await import("../../src/lib/privacy/store.ts");
  const config = await getPrivacyConfig();
  const enabledConfig = await updatePrivacyConfig({
    profiles: config.profiles.map((profile) =>
      profile.id === "default-external" ? { ...profile, enabled: true } : profile
    ),
  });
  await activatePrivacyBundle({
    version: "privacy-test-active",
    compiledBundle: enabledConfig,
    changeSummary: "Enable default privacy profile",
    compiledBy: "unit-test",
  });
}

test("privacy control plane workspace adapts store config into task-first models", async () => {
  await enableDefaultProfile();
  const { getPrivacyControlPlaneWorkspace } = await import(
    "../../src/lib/privacy/controlPlane.ts"
  );

  const workspace = await getPrivacyControlPlaneWorkspace();

  assert.equal(workspace.overview.activeBundleVersion, "privacy-test-active");
  assert.ok(workspace.overview.managedRules >= 1);
  assert.ok(workspace.config.entityTypes.some((entity) => entity.usageCount >= 0));
  assert.ok(workspace.sourceApps.some((source) => source.key === "openwebui"));
  assert.ok(workspace.settings.vaultEnabled);
  assert.ok(Array.isArray(workspace.incidents));
  assert.ok(workspace.bundles.some((bundle) => bundle.version === "privacy-test-active"));
});

test("privacy control plane test runner explains detection, transform, validation, and restore tokens", async () => {
  await enableDefaultProfile();
  const { runPrivacyControlPlaneTest } = await import("../../src/lib/privacy/controlPlane.ts");

  const result = await runPrivacyControlPlaneTest({
    inputMode: "plain-text",
    rawInput: "Please review OCB-PRJ-123 with ana@example.com",
    sourceApp: "openwebui",
    profileId: "default-external",
    bundleVersion: "privacy-test-active",
  });

  assert.equal(result.sourceApp, "openwebui");
  assert.equal(result.decision, "transformed");
  assert.match(result.sanitizedOutput, /\[PROJECT_001\]/);
  assert.match(result.sanitizedOutput, /\[EMAIL_MASKED\]/);
  assert.ok(result.detectedEntities.some((entity) => entity.entityKey === "project_code"));
  assert.ok(result.matchedRules.some((rule) => rule.id === "rule-project-code"));
  assert.equal(result.validator.passed, true);
  assert.ok(result.restoreTokens.some((token) => token.token === "[PROJECT_001]"));
  assert.deepEqual(
    result.pipeline.map((step) => step.step),
    ["Detect", "Classify", "Transform", "Validate", "Restore"]
  );
});

test("privacy control plane saves settings and publishes or rolls back bundles", async () => {
  await enableDefaultProfile();
  const {
    getPrivacyControlPlaneWorkspace,
    savePrivacyControlPlaneSettings,
    publishPrivacyDraftBundle,
    rollbackPrivacyBundle,
  } = await import("../../src/lib/privacy/controlPlane.ts");

  const saved = await savePrivacyControlPlaneSettings({
    tokenTtlSeconds: 7200,
    auditRetentionDays: 60,
    fallbackToLocalLlm: true,
  });
  assert.equal(saved.tokenTtlSeconds, 7200);
  assert.equal(saved.auditRetentionDays, 60);
  assert.equal(saved.fallbackToLocalLlm, true);

  const published = await publishPrivacyDraftBundle({
    notes: "Publish unit test policy",
    actor: "unit-test",
  });
  assert.match(published.version, /^privacy-release-/);

  const afterPublish = await getPrivacyControlPlaneWorkspace();
  assert.equal(afterPublish.overview.activeBundleVersion, published.version);

  const rolledBack = await rollbackPrivacyBundle({
    version: "privacy-test-active",
    actor: "unit-test",
  });
  assert.equal(rolledBack.version, "privacy-test-active");
});
