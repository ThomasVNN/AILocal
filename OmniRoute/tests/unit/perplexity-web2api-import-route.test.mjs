import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-pplx-import-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const importRoute = await import("../../src/app/api/oauth/perplexity-web2api/import/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("Perplexity import route normalizes cookie header and persists active session metadata", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        user: {
          id: "user_123",
          email: "pplx@example.com",
          name: "Perplexity User",
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
    const request = new Request("http://localhost/api/oauth/perplexity-web2api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookieString:
          "Cookie: __Secure-next-auth.session-token=abc123; cf_clearance=stale; pplx.session-id=session-1",
      }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.success, true);

    const connections = await providersDb.getProviderConnections({
      provider: "perplexity-web2api",
    });
    assert.equal(connections.length, 1);

    const stored = connections[0];
    assert.equal(stored.email, "pplx@example.com");
    assert.equal(stored.displayName, "Perplexity User");
    assert.equal(stored.testStatus, "active");
    assert.match(stored.accessToken, /__Secure-next-auth\.session-token=abc123/);
    assert.match(stored.accessToken, /cf_clearance=fresh-clearance/);
    assert.equal(stored.providerSpecificData.sessionStatus, "active");
    assert.deepEqual(stored.providerSpecificData.cookieNames.sort(), [
      "__Secure-next-auth.session-token",
      "cf_clearance",
      "pplx.session-id",
    ]);
    assert.equal(stored.providerSpecificData.sessionEmail, "pplx@example.com");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Perplexity import route rejects malformed cookie payloads before persistence", async () => {
  await resetStorage();

  const request = new Request("http://localhost/api/oauth/perplexity-web2api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookieString: "not-a-cookie-header" }),
  });

  const response = await importRoute.POST(request);
  assert.equal(response.status, 400);

  const payload = await response.json();
  assert.equal(payload.code, "invalid_cookie_format");

  const connections = await providersDb.getProviderConnections({ provider: "perplexity-web2api" });
  assert.equal(connections.length, 0);
});

test("Perplexity import route accepts JSON cookie export array", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        user: {
          id: "user_json_cookie",
          email: "pplx-json@example.com",
          name: "Perplexity JSON User",
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );

  try {
    const cookieExport = [
      { name: "__Secure-next-auth.session-token", value: "json-token-1" },
      { name: "cf_clearance", value: "cf-json" },
      { name: "pplx.session-id", value: "session-json" },
    ];

    const request = new Request("http://localhost/api/oauth/perplexity-web2api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookieString: JSON.stringify(cookieExport),
      }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 200);

    const connections = await providersDb.getProviderConnections({
      provider: "perplexity-web2api",
    });
    assert.equal(connections.length, 1);

    const stored = connections[0];
    assert.match(stored.accessToken, /__Secure-next-auth\.session-token=json-token-1/);
    assert.match(stored.accessToken, /cf_clearance=cf-json/);
    assert.match(stored.accessToken, /pplx\.session-id=session-json/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
