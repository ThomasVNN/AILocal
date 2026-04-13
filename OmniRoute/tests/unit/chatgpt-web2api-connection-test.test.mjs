import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-chatgpt-conn-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const providerTestRoute = await import("../../src/app/api/providers/[id]/test/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function seedConnection(
  accessToken = "chatgpt-access-seed",
  refreshToken = "__Secure-next-auth.session-token=seed; oai-did=dev-1"
) {
  return providersDb.createProviderConnection({
    provider: "chatgpt-web2api",
    authType: "oauth",
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      authMethod: "web2api",
      sessionStatus: "active",
      cookieString: refreshToken,
      importedAt: new Date().toISOString(),
    },
  });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("testSingleConnection validates ChatGPT web sessions and refreshes stored token+cookies", async () => {
  await resetStorage();
  const connection = await seedConnection();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        user: {
          id: "user_456",
          email: "session@example.com",
          name: "Session User",
        },
        accessToken: "chatgpt-access-fresh",
        account_id: "acc_live",
        plan_type: "pro",
        expires: new Date(Date.now() + 40 * 60 * 1000).toISOString(),
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "__Secure-next-auth.session-token=fresh-cookie; Path=/; HttpOnly",
        },
      }
    );

  try {
    const result = await providerTestRoute.testSingleConnection(connection.id);
    assert.equal(result.valid, true);

    const updated = await providersDb.getProviderConnectionById(connection.id);
    assert.equal(updated.testStatus, "active");
    assert.equal(updated.accessToken, "chatgpt-access-fresh");
    assert.match(updated.refreshToken, /__Secure-next-auth\.session-token=fresh-cookie/);
    assert.equal(updated.providerSpecificData.sessionStatus, "active");
    assert.equal(updated.providerSpecificData.sessionEmail, "session@example.com");
    assert.equal(updated.providerSpecificData.workspaceId, "acc_live");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testSingleConnection marks invalid ChatGPT sessions as expired and requiring re-auth", async () => {
  await resetStorage();
  const connection = await seedConnection();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

  try {
    const result = await providerTestRoute.testSingleConnection(connection.id);
    assert.equal(result.valid, false);

    const updated = await providersDb.getProviderConnectionById(connection.id);
    assert.equal(updated.testStatus, "expired");
    assert.equal(updated.providerSpecificData.sessionStatus, "reauth_required");
    assert.match(updated.lastError, /Session expired|invalid/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
