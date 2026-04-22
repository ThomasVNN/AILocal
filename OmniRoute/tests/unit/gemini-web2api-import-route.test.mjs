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

function buildGeminiBootstrapHtml() {
  return `<!doctype html><script>window.WIZ_global_data={"thykhd":"gemini-at-token","cfb2h":"boq_assistant-bard-web-server_20260419.08_p0","FdrFJe":"4371343308878890333","TuX5cc":"en","qKIAYe":"feeds/mcudyrk2a4khkz"};</script>`;
}

function buildGeminiStreamFrame(text = "pong") {
  const candidate = [];
  candidate[0] = "rcid-test";
  candidate[1] = [text];
  candidate[8] = [2];

  const inner = [];
  inner[4] = [candidate];

  const outer = [];
  outer[2] = JSON.stringify(inner);

  const payload = JSON.stringify([outer]);
  return `)]}'\n${payload.length + 2}\n${payload}\n`;
}

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
  let capturedCookie = null;

  globalThis.fetch = async (url, init) => {
    const headers = new Headers(init?.headers || {});
    if (String(url).includes("/app")) {
      return new Response(buildGeminiBootstrapHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    capturedCookie = headers.get("cookie");

    return new Response(buildGeminiStreamFrame("pong"), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
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

    assert.match(capturedCookie, /SAPISID=CookieSapValue123/);

    const connections = await providersDb.getProviderConnections({ provider: "gemini-web2api" });
    assert.equal(connections.length, 1);
    assert.equal(connections[0].testStatus, "active");
    assert.equal(connections[0].providerSpecificData.sessionStatus, "active");
    assert.equal(connections[0].providerSpecificData.authMode, "authorization");
    assert.equal(connections[0].providerSpecificData.routePrefix, "");
    assert.equal(connections[0].providerSpecificData.streamQueryParams, null);
    assert.equal(connections[0].providerSpecificData.streamRequestTemplate, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini Web2API import route stores curl cookie captures", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  let capturedCookie = null;

  globalThis.fetch = async (url, init) => {
    const headers = new Headers(init?.headers || {});
    if (String(url).includes("/app")) {
      return new Response(buildGeminiBootstrapHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    capturedCookie = headers.get("cookie");

    return new Response(buildGeminiStreamFrame("pong"), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };

  const curlCapture = [
    "curl 'https://gemini.google.com/u/1/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20260419.08_p0&f.sid=4371343308878890333&hl=en&pageId=none&_reqid=4164129&rt=c'",
    "  -H 'accept: */*'",
    "  -H 'origin: https://gemini.google.com'",
    "  -H 'referer: https://gemini.google.com/'",
    "  -b 'SAPISID=CurlSapValue123; __Secure-1PAPISID=Curl1PValue123; __Secure-3PAPISID=Curl3PValue123'",
    "  --data-raw 'f.req=%5Bnull%2C%22%5B%5B%5C%22hi%20%5C%22%2C0%2Cnull%2Cnull%2Cnull%2Cnull%2C0%5D%2C%5B%5C%22en%5C%22%5D%2C%5B%5C%22%5C%22%2C%5C%22%5C%22%2C%5C%22%5C%22%5D%2Cnull%2Cnull%2Cnull%2C%5B1%5D%2C1%5D%22%5D&at=gemini-at-token&'",
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

    assert.match(capturedCookie, /SAPISID=CurlSapValue123/);

    const connections = await providersDb.getProviderConnections({ provider: "gemini-web2api" });
    assert.equal(connections.length, 1);
    assert.equal(connections[0].providerSpecificData.sessionStatus, "active");
    assert.equal(connections[0].providerSpecificData.authMode, "authorization");
    assert.equal(connections[0].providerSpecificData.routePrefix, "/u/1");
    assert.equal(
      connections[0].providerSpecificData.streamQueryParams?.bl,
      "boq_assistant-bard-web-server_20260419.08_p0"
    );
    assert.match(
      connections[0].providerSpecificData.streamRequestTemplate || "",
      /\[\["hi /
    );
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
