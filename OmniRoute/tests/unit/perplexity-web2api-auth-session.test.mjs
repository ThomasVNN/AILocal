import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-pplx-auth-"));
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

test("getProviderCredentials skips Perplexity web sessions that require re-auth", async () => {
  await resetStorage();

  const blocked = await providersDb.createProviderConnection({
    provider: "perplexity-web2api",
    authType: "oauth",
    accessToken: "__Secure-next-auth.session-token=blocked",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      authMethod: "web2api",
      sessionStatus: "reauth_required",
    },
  });

  const healthy = await providersDb.createProviderConnection({
    provider: "perplexity-web2api",
    authType: "oauth",
    accessToken: "__Secure-next-auth.session-token=healthy",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      authMethod: "web2api",
      sessionStatus: "active",
    },
  });

  const selected = await auth.getProviderCredentials("perplexity-web2api");
  assert.ok(selected);
  assert.equal(selected.connectionId, healthy.id);
  assert.notEqual(selected.connectionId, blocked.id);
});

test("markAccountUnavailable turns Perplexity 401/403 into terminal re-auth status", async () => {
  await resetStorage();

  const connection = await providersDb.createProviderConnection({
    provider: "perplexity-web2api",
    authType: "oauth",
    accessToken: "__Secure-next-auth.session-token=expired",
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
    "perplexity-web2api",
    "sonar"
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
