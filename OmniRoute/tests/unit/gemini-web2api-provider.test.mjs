import test from "node:test";
import assert from "node:assert/strict";

const { OAUTH_PROVIDERS, APIKEY_PROVIDERS } =
  await import("../../src/shared/constants/providers.ts");
const { validateProviderApiKey } = await import("../../src/lib/providers/validation.ts");
const { getStaticModelsForProvider } =
  await import("../../src/app/api/providers/[id]/models/route.ts");
const { REGISTRY } = await import("../../open-sse/config/providerRegistry.ts");

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

test("OAUTH_PROVIDERS includes gemini-web2api", () => {
  assert.ok(OAUTH_PROVIDERS["gemini-web2api"]);
  const provider = OAUTH_PROVIDERS["gemini-web2api"];
  assert.equal(provider.id, "gemini-web2api");
  assert.equal(provider.alias, "gemini-w2a");
  assert.equal(provider.name, "Gemini (Web2API)");
});

test("gemini-web2api is not in APIKEY_PROVIDERS", () => {
  assert.equal(APIKEY_PROVIDERS["gemini-web2api"], undefined);
});

test("REGISTRY includes gemini-web2api with openai format", () => {
  const entry = REGISTRY["gemini-web2api"];
  assert.ok(entry);
  assert.equal(entry.format, "openai");
  assert.equal(entry.authType, "oauth");
  assert.equal(entry.authHeader, "cookie");
});

test("getStaticModelsForProvider returns static models for gemini-web2api", () => {
  const models = getStaticModelsForProvider("gemini-web2api");
  assert.ok(Array.isArray(models));
  assert.ok(models.length >= 3);
  const ids = new Set(models.map((m) => m.id));
  assert.ok(ids.has("gemini-2.5-pro"));
  assert.ok(ids.has("gemini-2.5-flash"));
});

test("validateProviderApiKey rejects Gemini API keys for gemini-web2api", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called for rejected API key input");
  };

  try {
    const result = await validateProviderApiKey({
      provider: "gemini-web2api",
      apiKey: "x-goog-api-key\nAIzaTestGeminiWebKey\norigin\nhttps://gemini.google.com",
    });

    assert.equal(result.valid, false);
    assert.equal(result.code, "gemini_api_key_not_supported");
    assert.match(result.error || "", /official Gemini/i);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey accepts tabular capture with cookie-only auth", async () => {
  const originalFetch = globalThis.fetch;
  let capturedCookie = null;
  let capturedStreamUrl = null;

  globalThis.fetch = async (url, init) => {
    const headers = new Headers(init?.headers || {});
    if (String(url).includes("/app")) {
      return new Response(buildGeminiBootstrapHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    capturedCookie = headers.get("cookie");
    capturedStreamUrl = String(url);

    return new Response(buildGeminiStreamFrame("pong"), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };

  const tabularCapture = [
    ":method\tPOST",
    ":authority\tgemini.google.com",
    "origin\thttps://gemini.google.com",
    "cookie\tSAPISID=TabSapValue123",
    "cookie\t__Secure-1PAPISID=Tab1PValue123",
    "cookie\t__Secure-3PAPISID=Tab3PValue123",
  ].join("\n");

  try {
    const result = await validateProviderApiKey({
      provider: "gemini-web2api",
      apiKey: tabularCapture,
    });

    assert.equal(result.valid, true);
    assert.equal(result.error, null);
    assert.match(capturedCookie, /SAPISID=TabSapValue123/);
    assert.match(capturedCookie, /__Secure-1PAPISID=Tab1PValue123/);
    assert.match(capturedStreamUrl || "", /gemini\.google\.com/);
    assert.match(capturedStreamUrl || "", /StreamGenerate/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey accepts cURL capture with cookie-only auth", async () => {
  const originalFetch = globalThis.fetch;
  let capturedCookie = null;
  let capturedStreamUrl = null;

  globalThis.fetch = async (url, init) => {
    const headers = new Headers(init?.headers || {});
    if (String(url).includes("/app")) {
      return new Response(buildGeminiBootstrapHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    capturedCookie = headers.get("cookie");
    capturedStreamUrl = String(url);

    return new Response(buildGeminiStreamFrame("pong"), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };

  const curlCapture = [
    "curl 'https://gemini.google.com/u/1/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20260419.08_p0&f.sid=4371343308878890333&hl=en&pageId=none&_reqid=4164129&rt=c'",
    "  -H 'origin: https://gemini.google.com'",
    "  -H 'cookie: SAPISID=CurlSapValue123; __Secure-1PAPISID=Curl1PValue123'",
    "  --data-raw 'f.req=%5Bnull%2C%22%5B%5B%5C%22hi%20%5C%22%2C0%2Cnull%2Cnull%2Cnull%2Cnull%2C0%5D%2C%5B%5C%22en%5C%22%5D%5D%22%5D&at=gemini-at-token&'",
  ].join(" \\\n");

  try {
    const result = await validateProviderApiKey({
      provider: "gemini-web2api",
      apiKey: curlCapture,
    });

    assert.equal(result.valid, true);
    assert.equal(result.error, null);
    assert.match(capturedCookie, /SAPISID=CurlSapValue123/);
    assert.match(capturedCookie, /__Secure-1PAPISID=Curl1PValue123/);
    assert.match(capturedStreamUrl || "", /\/u\/1\/_/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey succeeds when Gemini web bootstrap and StreamGenerate succeed", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET" });
    if (String(url).includes("/app")) {
      return new Response(buildGeminiBootstrapHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    return new Response(buildGeminiStreamFrame("pong"), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };

  try {
    const result = await validateProviderApiKey({
      provider: "gemini-web2api",
      apiKey:
        "curl 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=aPya6c&bl=boq_assistant-bard-web-server_20260419.08_p0&f.sid=4371343308878890333&hl=en&pageId=none&_reqid=4464129&rt=c' -H 'origin: https://gemini.google.com' -H 'cookie: SAPISID=CurlSapValue123; __Secure-1PAPISID=Curl1PValue123' --data-raw 'f.req=%5B%5B%5B%22aPya6c%22%2C%22%5B%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&at=gemini-at-token&'",
    });

    assert.equal(result.valid, true);
    assert.equal(result.error, null);
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]?.url || "", /rpcids=aPya6c/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
