import test from "node:test";
import assert from "node:assert/strict";

const { OAUTH_PROVIDERS, APIKEY_PROVIDERS } =
  await import("../../src/shared/constants/providers.ts");
const { validateProviderApiKey } = await import("../../src/lib/providers/validation.ts");
const { getStaticModelsForProvider } =
  await import("../../src/app/api/providers/[id]/models/route.ts");
const { REGISTRY } = await import("../../open-sse/config/providerRegistry.ts");
const { getModelInfoCore } = await import("../../open-sse/services/model.ts");

test("OAUTH_PROVIDERS includes chatgpt-web2api", () => {
  assert.ok(OAUTH_PROVIDERS["chatgpt-web2api"]);
  const provider = OAUTH_PROVIDERS["chatgpt-web2api"];
  assert.equal(provider.id, "chatgpt-web2api");
  assert.equal(provider.alias, "chatgpt-w2a");
  assert.equal(provider.name, "ChatGPT (Web2API)");
});

test("chatgpt-web2api is not in APIKEY_PROVIDERS", () => {
  assert.equal(APIKEY_PROVIDERS["chatgpt-web2api"], undefined);
});

test("REGISTRY includes chatgpt-web2api with openai-responses format", () => {
  const entry = REGISTRY["chatgpt-web2api"];
  assert.ok(entry);
  assert.equal(entry.format, "openai-responses");
  assert.equal(entry.authType, "oauth");
  assert.equal(entry.authHeader, "bearer");
});

test("getStaticModelsForProvider returns static models for chatgpt-web2api", () => {
  const models = getStaticModelsForProvider("chatgpt-web2api");
  assert.ok(Array.isArray(models));
  assert.equal(models.length >= 5, true);
  const ids = new Set(models.map((m) => m.id));
  assert.ok(ids.has("gpt-5"));
  assert.ok(ids.has("gpt-5.2-codex"));
  assert.ok(ids.has("gpt-5-codex-mini"));
});

test("chatgpt-web2api keeps explicit model ids (no forced remap to gpt-5)", async () => {
  const cases = ["gpt-4o", "gpt-4.1", "o3", "o4-mini"];
  for (const modelId of cases) {
    const resolved = await getModelInfoCore(`chatgpt-web2api/${modelId}`, {});
    assert.equal(resolved.provider, "chatgpt-web2api");
    assert.equal(resolved.model, modelId);
  }
});

test("validateProviderApiKey returns valid for chatgpt-web2api session payload", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).includes("/api/auth/session")) {
      return new Response(
        JSON.stringify({
          user: { id: "user_123", email: "chatgpt@example.com", name: "ChatGPT User" },
          accessToken: "session-access-token",
          expires: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ limit: 42 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await validateProviderApiKey({
      provider: "chatgpt-web2api",
      apiKey: "chatgpt-access-token",
      providerSpecificData: {
        sessionPayload: {
          user: { id: "user_123", email: "chatgpt@example.com", name: "ChatGPT User" },
          accessToken: "chatgpt-access-token",
          sessionToken: "session-token-abc123",
        },
      },
    });

    assert.equal(result.valid, true);
    assert.equal(result.error, null);
    assert.equal(result.accessToken, "session-access-token");
    assert.equal(result.session.email, "chatgpt@example.com");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey rejects chatgpt-web2api session payload when cookie and access token are both invalid", async () => {
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
    const result = await validateProviderApiKey({
      provider: "chatgpt-web2api",
      apiKey: "chatgpt-access-token-invalid",
      providerSpecificData: {
        sessionPayload: {
          user: { id: "user_bad", email: "bad@example.com", name: "Bad User" },
          accessToken: "chatgpt-access-token-invalid",
          sessionToken: "session-token-invalid",
        },
      },
    });

    assert.equal(result.valid, false);
    assert.equal(result.statusCode, 401);
    assert.equal(result.code, "session_expired");
    assert.match(result.error, /reconnect/i);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey sends normalized Cookie header for chatgpt-web2api", async () => {
  const originalFetch = globalThis.fetch;
  let capturedCookie = null;

  globalThis.fetch = async (_url, init) => {
    capturedCookie = init?.headers?.Cookie || null;
    return new Response(
      JSON.stringify({
        user: { id: "user_cookie", email: "cookie@example.com", name: "Cookie User" },
        accessToken: "cookie-access-token",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  try {
    const cookie = "Cookie: __Secure-next-auth.session-token=token-1; oai-did=device-1";
    const result = await validateProviderApiKey({
      provider: "chatgpt-web2api",
      apiKey: cookie,
    });

    assert.equal(result.valid, true);
    assert.equal(
      capturedCookie,
      "__Secure-next-auth.session-token=token-1; oai-did=device-1",
      "Cookie header should be normalized and include all pairs"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
