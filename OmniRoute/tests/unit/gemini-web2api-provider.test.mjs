import test from "node:test";
import assert from "node:assert/strict";

const { OAUTH_PROVIDERS, APIKEY_PROVIDERS } =
  await import("../../src/shared/constants/providers.ts");
const { validateProviderApiKey } = await import("../../src/lib/providers/validation.ts");
const { getStaticModelsForProvider } =
  await import("../../src/app/api/providers/[id]/models/route.ts");
const { REGISTRY } = await import("../../open-sse/config/providerRegistry.ts");

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

test("REGISTRY includes gemini-web2api with gemini format", () => {
  const entry = REGISTRY["gemini-web2api"];
  assert.ok(entry);
  assert.equal(entry.format, "gemini");
  assert.equal(entry.authType, "oauth");
  assert.equal(entry.authHeader, "x-goog-api-key");
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
    assert.match(capturedAuthorization, /^SAPISIDHASH\s+\d+_[0-9a-f]{40}/i);
    assert.match(capturedCookie, /SAPISID=TabSapValue123/);
    assert.match(capturedCookie, /__Secure-1PAPISID=Tab1PValue123/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey accepts cURL capture with cookie-only auth", async () => {
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
    "curl 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate'",
    "  -H 'origin: https://gemini.google.com'",
    "  -H 'cookie: SAPISID=CurlSapValue123; __Secure-1PAPISID=Curl1PValue123'",
  ].join(" \\\n");

  try {
    const result = await validateProviderApiKey({
      provider: "gemini-web2api",
      apiKey: curlCapture,
    });

    assert.equal(result.valid, true);
    assert.equal(result.error, null);
    assert.match(capturedAuthorization, /^SAPISIDHASH\s+\d+_[0-9a-f]{40}/i);
    assert.match(capturedCookie, /SAPISID=CurlSapValue123/);
    assert.match(capturedCookie, /__Secure-1PAPISID=Curl1PValue123/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey succeeds when generateContent passes but models discovery is forbidden", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET" });
    if (String(url).includes(":generateContent")) {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "pong" }] } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await validateProviderApiKey({
      provider: "gemini-web2api",
      apiKey:
        "curl 'https://gemini.google.com/_/BardChatUi/data/batchexecute' -H 'origin: https://gemini.google.com' -H 'cookie: SAPISID=CurlSapValue123; __Secure-1PAPISID=Curl1PValue123'",
    });

    assert.equal(result.valid, true);
    assert.equal(result.error, null);
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]?.url || "", /:generateContent$/);
    assert.equal(calls[1]?.method, "GET");
    assert.match(calls[1]?.url || "", /\/models\?pageSize=1000$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
