import test from "node:test";
import assert from "node:assert/strict";

// Import constants
const { OAUTH_PROVIDERS, APIKEY_PROVIDERS } =
  await import("../../src/shared/constants/providers.ts");

// Import validateProviderApiKey for validation tests
const { validateProviderApiKey } = await import("../../src/lib/providers/validation.ts");

// Import static model helper
const { getStaticModelsForProvider } =
  await import("../../src/app/api/providers/[id]/models/route.ts");

// Import registry
const { REGISTRY } = await import("../../open-sse/config/providerRegistry.ts");

// ============================================================================
// Provider Registration Tests
// ============================================================================

test("OAUTH_PROVIDERS includes perplexity-web2api", () => {
  assert.ok(
    OAUTH_PROVIDERS["perplexity-web2api"],
    "perplexity-web2api should be present in OAUTH_PROVIDERS"
  );

  const provider = OAUTH_PROVIDERS["perplexity-web2api"];
  assert.equal(provider.id, "perplexity-web2api", "Provider id should be 'perplexity-web2api'");
  assert.equal(provider.alias, "pplx-w2a", "Provider alias should be 'pplx-w2a'");
  assert.equal(
    provider.name,
    "Perplexity (Web2API)",
    "Provider name should be 'Perplexity (Web2API)'"
  );
  assert.equal(provider.color, "#20808D", "Provider color should be '#20808D'");
});

test("perplexity-web2api not in APIKEY_PROVIDERS", () => {
  assert.equal(
    APIKEY_PROVIDERS["perplexity-web2api"],
    undefined,
    "perplexity-web2api should NOT be present in APIKEY_PROVIDERS"
  );
});

test("perplexity-web2api is distinct from perplexity (API key)", () => {
  assert.ok(
    APIKEY_PROVIDERS["perplexity"],
    "perplexity (API key) should still exist in APIKEY_PROVIDERS"
  );
  assert.notEqual(
    OAUTH_PROVIDERS["perplexity-web2api"].id,
    APIKEY_PROVIDERS["perplexity"].id,
    "IDs should be different"
  );
});

// ============================================================================
// Registry Tests
// ============================================================================

test("REGISTRY includes perplexity-web2api entry", () => {
  assert.ok(REGISTRY["perplexity-web2api"], "Registry should have perplexity-web2api entry");
});

test("perplexity-web2api registry entry has correct format", () => {
  const entry = REGISTRY["perplexity-web2api"];
  assert.equal(entry.format, "perplexity-web2api", "Format should be perplexity-web2api");
  assert.equal(entry.authType, "oauth", "Auth type should be oauth");
  assert.equal(entry.authHeader, "cookie", "Auth header should be cookie");
  assert.equal(entry.executor, "default", "Executor should be default");
});

test("perplexity-web2api registry entry has browser-like headers", () => {
  const entry = REGISTRY["perplexity-web2api"];
  assert.ok(entry.headers, "Should have headers");
  assert.ok(entry.headers["User-Agent"], "Should have User-Agent header");
  assert.ok(entry.headers["Origin"], "Should have Origin header");
  assert.ok(entry.headers["Referer"], "Should have Referer header");
});

test("perplexity-web2api registry models match static models", () => {
  const registryModels = REGISTRY["perplexity-web2api"].models;
  const staticModels = getStaticModelsForProvider("perplexity-web2api");

  assert.ok(staticModels, "Static models should be defined");
  assert.ok(
    staticModels.length >= registryModels.length,
    "Static model list should be at least as large as registry defaults"
  );

  const staticIds = new Set(staticModels.map((m) => m.id));
  for (const model of registryModels) {
    assert.ok(staticIds.has(model.id), `Static models should include registry model: ${model.id}`);
  }
});

// ============================================================================
// Static Model Tests
// ============================================================================

test("getStaticModelsForProvider returns models for perplexity-web2api", () => {
  const models = getStaticModelsForProvider("perplexity-web2api");

  assert.ok(models, "Should return models for perplexity-web2api");
  assert.ok(Array.isArray(models), "Should return an array");
  assert.ok(models.length >= 2, "Should return at least the baseline web models");
});

test("perplexity-web2api models have correct structure", () => {
  const models = getStaticModelsForProvider("perplexity-web2api");

  for (const model of models) {
    assert.ok(model.id, `Model should have id: ${JSON.stringify(model)}`);
    assert.ok(model.name, `Model should have name: ${JSON.stringify(model)}`);
    assert.equal(typeof model.id, "string", "Model id should be string");
    assert.equal(typeof model.name, "string", "Model name should be string");
  }
});

test("perplexity-web2api models include expected IDs", () => {
  const models = getStaticModelsForProvider("perplexity-web2api");
  const ids = models.map((m) => m.id);

  assert.ok(ids.includes("default"), "Should include 'default' model");
  assert.ok(ids.includes("gpt-4o"), "Should include 'gpt-4o' model");
});

test("perplexity-web2api models have no duplicates", () => {
  const models = getStaticModelsForProvider("perplexity-web2api");
  const ids = models.map((m) => m.id);
  const uniqueIds = new Set(ids);
  assert.equal(ids.length, uniqueIds.size, "All model IDs should be unique");
});

// ============================================================================
// Validation Tests (with mocked fetch)
// ============================================================================

test("validateProviderApiKey returns valid for 200 with user data (perplexity-web2api)", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ user: { email: "test@example.com", name: "Test" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const result = await validateProviderApiKey({
      provider: "perplexity-web2api",
      apiKey: "valid-session-token",
    });

    assert.equal(result.valid, true, "Should return valid for 200 with user data");
    assert.equal(result.error, null, "Error should be null");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey returns invalid for 200 without user data (perplexity-web2api)", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const result = await validateProviderApiKey({
      provider: "perplexity-web2api",
      apiKey: "expired-session-token",
    });

    assert.equal(result.valid, false, "Should return invalid for 200 without user data");
    assert.ok(result.error.includes("expired"), "Error should mention expiration");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey returns invalid for 401 (perplexity-web2api)", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

  try {
    const result = await validateProviderApiKey({
      provider: "perplexity-web2api",
      apiKey: "invalid-token",
    });

    assert.equal(result.valid, false, "Should return invalid for 401");
    assert.ok(
      result.error.includes("expired") || result.error.includes("invalid"),
      "Error should mention expired or invalid"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey returns invalid for 403 (perplexity-web2api)", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });

  try {
    const result = await validateProviderApiKey({
      provider: "perplexity-web2api",
      apiKey: "forbidden-token",
    });

    assert.equal(result.valid, false, "Should return invalid for 403");
    assert.ok(
      result.error.includes("expired") || result.error.includes("invalid"),
      "Error should mention expired or invalid"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey returns invalid for 500 (perplexity-web2api)", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

  try {
    const result = await validateProviderApiKey({
      provider: "perplexity-web2api",
      apiKey: "bad-token",
    });

    assert.equal(result.valid, false, "Should return invalid for 500");
    assert.equal(result.error, "Validation failed: 500");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateProviderApiKey sends correct Cookie header (perplexity-web2api)", async () => {
  const originalFetch = globalThis.fetch;
  const capturedHeaders = {};

  globalThis.fetch = async (_url, init) => {
    const headers = init?.headers || {};
    Object.assign(capturedHeaders, headers);
    return new Response(JSON.stringify({ user: { email: "test@example.com" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await validateProviderApiKey({
      provider: "perplexity-web2api",
      apiKey: "my-session-token-123",
    });

    assert.ok(capturedHeaders.Cookie, "Should send Cookie header");
    assert.ok(
      capturedHeaders.Cookie.includes("next-auth.session-token=my-session-token-123"),
      "Cookie should contain the session token"
    );
    assert.ok(capturedHeaders["User-Agent"], "Should send User-Agent header");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
