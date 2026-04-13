import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-pplx-conn-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const providerTestRoute = await import("../../src/app/api/providers/[id]/test/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function seedConnection(accessToken = "__Secure-next-auth.session-token=seed") {
  return providersDb.createProviderConnection({
    provider: "perplexity-web2api",
    authType: "oauth",
    accessToken,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      authMethod: "web2api",
      sessionStatus: "active",
      importedAt: new Date().toISOString(),
    },
  });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("testSingleConnection validates Perplexity web sessions and refreshes stored cookies", async () => {
  await resetStorage();
  const connection = await seedConnection(
    "__Secure-next-auth.session-token=seed; cf_clearance=stale-clearance"
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        user: {
          id: "user_456",
          email: "session@example.com",
          name: "Session User",
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "cf_clearance=fresh-clearance; Path=/; HttpOnly",
        },
      }
    );

  try {
    const result = await providerTestRoute.testSingleConnection(connection.id);
    assert.equal(result.valid, true);

    const updated = await providersDb.getProviderConnectionById(connection.id);
    assert.equal(updated.testStatus, "active");
    assert.equal(updated.providerSpecificData.sessionStatus, "active");
    assert.equal(updated.providerSpecificData.sessionEmail, "session@example.com");
    assert.match(updated.accessToken, /cf_clearance=fresh-clearance/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testSingleConnection marks invalid Perplexity sessions as expired and requiring re-auth", async () => {
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
