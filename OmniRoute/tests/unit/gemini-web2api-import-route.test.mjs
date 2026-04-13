import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-gemini-web-import-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const importRoute = await import("../../src/app/api/oauth/gemini-web2api/import/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("Gemini Web2API import route rejects Gemini API key input", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called for rejected API key input");
  };

  try {
    const request = new Request("http://localhost/api/oauth/gemini-web2api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionInput: "x-goog-api-key\nAIzaGeminiImportKey\norigin\nhttps://gemini.google.com",
      }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 400);

    const payload = await response.json();
    assert.equal(payload.code, "gemini_api_key_not_supported");
    assert.match(payload.error || "", /Google AI Studio/i);
    assert.equal(fetchCalled, false);

    const connections = await providersDb.getProviderConnections({ provider: "gemini-web2api" });
    assert.equal(connections.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini Web2API import route stores cookie-only web session exports", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  let capturedAuthorization = null;
  let capturedCookie = null;

  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers || {});
    capturedAuthorization = headers.get("authorization");
    capturedCookie = headers.get("cookie");

    return new Response(
      JSON.stringify({
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  const cookieExport = [
    { name: "SAPISID", value: "CookieSapValue123" },
    { name: "__Secure-1PAPISID", value: "Cookie1PValue123" },
    { name: "__Secure-3PAPISID", value: "Cookie3PValue123" },
  ];

  try {
    const request = new Request("http://localhost/api/oauth/gemini-web2api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionInput: JSON.stringify(cookieExport),
      }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.success, true);

    assert.match(capturedAuthorization, /^SAPISIDHASH\s+\d+_[0-9a-f]{40}/i);
    assert.match(capturedCookie, /SAPISID=CookieSapValue123/);

    const connections = await providersDb.getProviderConnections({ provider: "gemini-web2api" });
    assert.equal(connections.length, 1);
    assert.equal(connections[0].testStatus, "active");
    assert.equal(connections[0].providerSpecificData.sessionStatus, "active");
    assert.equal(connections[0].providerSpecificData.authMode, "authorization");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini Web2API import route stores curl cookie captures", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  let capturedAuthorization = null;
  let capturedCookie = null;

  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers || {});
    capturedAuthorization = headers.get("authorization");
    capturedCookie = headers.get("cookie");

    return new Response(
      JSON.stringify({
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  const curlCapture = [
    "curl 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=L5adhe'",
    "  -H 'accept: */*'",
    "  -H 'origin: https://gemini.google.com'",
    "  -H 'referer: https://gemini.google.com/'",
    "  -b 'SAPISID=CurlSapValue123; __Secure-1PAPISID=Curl1PValue123; __Secure-3PAPISID=Curl3PValue123'",
    "  --data-raw 'f.req=%5B%5D&at=token'",
  ].join(" \\\n");

  try {
    const request = new Request("http://localhost/api/oauth/gemini-web2api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionInput: curlCapture,
      }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.success, true);

    assert.match(capturedAuthorization, /^SAPISIDHASH\s+\d+_[0-9a-f]{40}/i);
    assert.match(capturedCookie, /SAPISID=CurlSapValue123/);

    const connections = await providersDb.getProviderConnections({ provider: "gemini-web2api" });
    assert.equal(connections.length, 1);
    assert.equal(connections[0].providerSpecificData.sessionStatus, "active");
    assert.equal(connections[0].providerSpecificData.authMode, "authorization");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini Web2API import route rejects empty payload", async () => {
  await resetStorage();

  const request = new Request("http://localhost/api/oauth/gemini-web2api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionInput: "   " }),
  });

  const response = await importRoute.POST(request);
  assert.equal(response.status, 400);

  const payload = await response.json();
  assert.equal(payload.code, "missing_session_input");

  const connections = await providersDb.getProviderConnections({ provider: "gemini-web2api" });
  assert.equal(connections.length, 0);
});
