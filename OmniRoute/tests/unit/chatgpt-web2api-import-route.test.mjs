import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-chatgpt-import-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const importRoute = await import("../../src/app/api/oauth/chatgpt-web2api/import/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("ChatGPT import route normalizes cookies and persists active web session metadata", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        user: {
          id: "user_123",
          email: "chatgpt@example.com",
          name: "ChatGPT User",
        },
        accessToken: "chatgpt-access-token",
        account_id: "acc_001",
        plan_type: "plus",
        expires: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "__Secure-next-auth.session-token=fresh-token; Path=/; HttpOnly",
        },
      }
    );

  try {
    const request = new Request("http://localhost/api/oauth/chatgpt-web2api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookieString: "Cookie: __Secure-next-auth.session-token=stale-token; oai-did=device-1",
      }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.success, true);

    const connections = await providersDb.getProviderConnections({ provider: "chatgpt-web2api" });
    assert.equal(connections.length, 1);

    const stored = connections[0];
    assert.equal(stored.email, "chatgpt@example.com");
    assert.equal(stored.displayName, "ChatGPT User");
    assert.equal(stored.accessToken, "chatgpt-access-token");
    assert.match(stored.refreshToken, /__Secure-next-auth\.session-token=fresh-token/);
    assert.equal(stored.testStatus, "active");
    assert.equal(stored.providerSpecificData.sessionStatus, "active");
    assert.equal(stored.providerSpecificData.workspaceId, "acc_001");
    assert.equal(stored.providerSpecificData.workspacePlanType, "plus");
    assert.equal(stored.providerSpecificData.sessionEmail, "chatgpt@example.com");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatGPT import route accepts session payload JSON", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        user: {
          id: "user_456",
          email: "payload@example.com",
          name: "Payload User",
        },
        accessToken: "chatgpt-access-token-payload",
        account: {
          id: "acc_payload",
          planType: "go",
        },
        expires: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );

  try {
    const request = new Request("http://localhost/api/oauth/chatgpt-web2api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionPayload: {
          user: {
            id: "user_456",
            email: "payload@example.com",
            name: "Payload User",
          },
          accessToken: "chatgpt-access-token-payload",
          sessionToken: "session-token-123",
          account: {
            id: "acc_payload",
            planType: "go",
          },
          expires: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
        },
      }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.success, true);

    const connections = await providersDb.getProviderConnections({ provider: "chatgpt-web2api" });
    assert.equal(connections.length, 1);

    const stored = connections[0];
    assert.equal(stored.email, "payload@example.com");
    assert.equal(stored.displayName, "Payload User");
    assert.equal(stored.accessToken, "chatgpt-access-token-payload");
    assert.match(stored.refreshToken, /__Secure-next-auth\.session-token=session-token-123/);
    assert.equal(stored.providerSpecificData.sessionSource, "browser_session_payload");
    assert.equal(stored.providerSpecificData.workspaceId, "acc_payload");
    assert.equal(stored.providerSpecificData.workspacePlanType, "go");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatGPT import route rejects session payloads that fail upstream validation", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).includes("/api/auth/session")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "expired" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const request = new Request("http://localhost/api/oauth/chatgpt-web2api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionPayload: {
          user: {
            id: "user_invalid",
            email: "invalid@example.com",
            name: "Invalid User",
          },
          accessToken: "chatgpt-access-token-invalid",
          sessionToken: "session-token-invalid",
        },
      }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 401);

    const payload = await response.json();
    assert.equal(payload.code, "session_expired");
    assert.match(payload.error, /reconnect/i);

    const connections = await providersDb.getProviderConnections({ provider: "chatgpt-web2api" });
    assert.equal(connections.length, 0);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatGPT import route rejects malformed cookie payloads before persistence", async () => {
  await resetStorage();

  const request = new Request("http://localhost/api/oauth/chatgpt-web2api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookieString: "not-a-cookie-header" }),
  });

  const response = await importRoute.POST(request);
  assert.equal(response.status, 400);

  const payload = await response.json();
  assert.equal(payload.code, "invalid_cookie_format");

  const connections = await providersDb.getProviderConnections({ provider: "chatgpt-web2api" });
  assert.equal(connections.length, 0);
});

test("ChatGPT import route accepts JSON cookie export array", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        user: {
          id: "user_json_cookie",
          email: "json-cookie@example.com",
          name: "JSON Cookie User",
        },
        accessToken: "chatgpt-access-token-json-cookie",
        expires: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );

  try {
    const cookieExport = [
      { name: "__Secure-next-auth.session-token", value: "json-token-1" },
      { name: "oai-did", value: "device-json" },
      { name: "foo", value: "bar" },
    ];

    const request = new Request("http://localhost/api/oauth/chatgpt-web2api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookieString: JSON.stringify(cookieExport),
      }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 200);

    const connections = await providersDb.getProviderConnections({ provider: "chatgpt-web2api" });
    assert.equal(connections.length, 1);

    const stored = connections[0];
    assert.match(stored.refreshToken, /__Secure-next-auth\.session-token=json-token-1/);
    assert.match(stored.refreshToken, /oai-did=device-json/);
    assert.match(stored.refreshToken, /foo=bar/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
