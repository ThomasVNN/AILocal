import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-gemini-web-auth-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const auth = await import("../../src/sse/services/auth.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("getProviderCredentials skips Gemini web sessions that require re-auth", async () => {
  await resetStorage();

  const blocked = await providersDb.createProviderConnection({
    provider: "gemini-web2api",
    authType: "oauth",
    accessToken: "AIzaBlockedGemini",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      authMethod: "web2api",
      sessionStatus: "reauth_required",
    },
  });

  const healthy = await providersDb.createProviderConnection({
    provider: "gemini-web2api",
    authType: "oauth",
    accessToken: "SAPISIDHASH 12345_deadbeef",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      authMethod: "web2api",
      authorizationHeader: "SAPISIDHASH 12345_deadbeef",
      requestHeaders: {
        Cookie: "SAPISID=HealthySapValue123",
      },
      sessionStatus: "active",
    },
  });

  const selected = await auth.getProviderCredentials("gemini-web2api");
  assert.ok(selected);
  assert.equal(selected.connectionId, healthy.id);
  assert.notEqual(selected.connectionId, blocked.id);
});

test("getProviderCredentials skips legacy Gemini Web2API API-key connections", async () => {
  await resetStorage();

  await providersDb.createProviderConnection({
    provider: "gemini-web2api",
    authType: "oauth",
    accessToken: "AIzaLegacyGemini",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      authMethod: "web2api",
      authMode: "x-goog-api-key",
      sessionStatus: "active",
    },
  });

  const healthy = await providersDb.createProviderConnection({
    provider: "gemini-web2api",
    authType: "oauth",
    accessToken: "SAPISIDHASH 67890_feedface",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      authMethod: "web2api",
      authorizationHeader: "SAPISIDHASH 67890_feedface",
      requestHeaders: {
        Cookie: "SAPISID=HealthySapValue456",
      },
      sessionStatus: "active",
    },
  });

  const selected = await auth.getProviderCredentials("gemini-web2api");
  assert.ok(selected);
  assert.equal(selected.connectionId, healthy.id);
});

test("markAccountUnavailable turns Gemini Web2API 401/403 into terminal re-auth status", async () => {
  await resetStorage();

  const connection = await providersDb.createProviderConnection({
    provider: "gemini-web2api",
    authType: "oauth",
    accessToken: "AIzaExpiredGemini",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      authMethod: "web2api",
      sessionStatus: "active",
    },
  });

  const result = await auth.markAccountUnavailable(
    connection.id,
    401,
    "session expired",
    "gemini-web2api",
    "gemini-2.5-pro"
  );

  assert.equal(result.shouldFallback, true);
  assert.equal(result.cooldownMs, 0);

  const updated = await providersDb.getProviderConnectionById(connection.id);
  assert.equal(updated.testStatus, "expired");
  assert.equal(updated.lastErrorType, "reauth_required");
  assert.equal(updated.lastErrorSource, "oauth");
  assert.equal(updated.providerSpecificData.sessionStatus, "reauth_required");
  assert.equal(updated.providerSpecificData.lastSessionError, "session expired");
});
