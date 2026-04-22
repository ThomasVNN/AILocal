import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-gemini-legacy-migrate-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("DB startup migrates legacy Gemini Web2API API-key connections to official Gemini", async () => {
  await resetStorage();

  const db = core.getDbInstance();
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO provider_connections (
      id, provider, auth_type, priority, is_active,
      access_token, test_status, display_name, provider_specific_data,
      created_at, updated_at
    ) VALUES (
      @id, @provider, @authType, @priority, @isActive,
      @accessToken, @testStatus, @displayName, @providerSpecificData,
      @createdAt, @updatedAt
    )
  `
  ).run({
    id: "legacy-gemini-web2api-key",
    provider: "gemini-web2api",
    authType: "oauth",
    priority: 1,
    isActive: 1,
    accessToken: "AIzaLegacyGeminiKey123456",
    testStatus: "active",
    displayName: "Gemini Web Session",
    providerSpecificData: JSON.stringify({
      authMethod: "web2api",
      authMode: "x-goog-api-key",
      sessionStatus: "active",
      requestHeaders: {
        "x-goog-api-key": "AIzaLegacyGeminiKey123456",
      },
    }),
    createdAt: now,
    updatedAt: now,
  });

  core.resetDbInstance();

  const geminiConnections = await providersDb.getProviderConnections({ provider: "gemini" });
  const geminiWebConnections = await providersDb.getProviderConnections({
    provider: "gemini-web2api",
  });

  assert.equal(geminiWebConnections.length, 0);
  assert.equal(geminiConnections.length, 1);

  const migrated = geminiConnections[0];
  assert.equal(migrated.provider, "gemini");
  assert.equal(migrated.authType, "apikey");
  assert.equal(migrated.apiKey, "AIzaLegacyGeminiKey123456");
  assert.equal(migrated.accessToken, undefined);
  assert.equal(migrated.displayName, "Gemini API Key");
  assert.equal(migrated.providerSpecificData?.authMethod, undefined);
  assert.equal(migrated.providerSpecificData?.authMode, undefined);
});
