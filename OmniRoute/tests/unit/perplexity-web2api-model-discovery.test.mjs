import test from "node:test";
import assert from "node:assert/strict";

const { discoverPerplexityWebModels, getPerplexityWeb2ApiFallbackModels } =
  await import("../../open-sse/utils/perplexityWebModels.ts");

test("discoverPerplexityWebModels returns fallback when token missing", async () => {
  const result = await discoverPerplexityWebModels("");

  assert.equal(result.source, "fallback_static");
  assert.equal(result.confidence, "low");
  assert.deepEqual(result.models, getPerplexityWeb2ApiFallbackModels());
});

test("discoverPerplexityWebModels parses model catalog response", async () => {
  const fetchMock = async () =>
    new Response(
      JSON.stringify({
        models: [
          { id: "sonar", display_name: "Sonar" },
          { id: "gpt-5.4", display_name: "GPT-5.4" },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );

  const result = await discoverPerplexityWebModels("cookie=value", fetchMock);

  assert.equal(result.source, "web_catalog");
  assert.equal(result.confidence, "high");
  assert.deepEqual(
    result.models.map((m) => m.id),
    ["gpt-5.4", "sonar"]
  );
});

test("discoverPerplexityWebModels falls back on cloudflare challenge", async () => {
  const fetchMock = async () =>
    new Response("<html><title>Just a moment...</title></html>", {
      status: 403,
      headers: { "content-type": "text/html" },
    });

  const result = await discoverPerplexityWebModels("cookie=value", fetchMock);

  assert.equal(result.source, "fallback_static");
  assert.equal(result.confidence, "low");
  assert.equal(result.models.length >= 2, true);
});

test("discoverPerplexityWebModels extracts models from search-models cookie state", async () => {
  const payload = encodeURIComponent(
    JSON.stringify({
      search: ["sonar", "gpt-5.4", "claude-sonnet-4.6"],
    })
  );
  const cookie = `pplx.search-models-v4=${payload}; __Secure-next-auth.session-token=abc`;

  const fetchMock = async () =>
    new Response("<html><title>Just a moment...</title></html>", {
      status: 403,
      headers: { "content-type": "text/html" },
    });

  const result = await discoverPerplexityWebModels(cookie, fetchMock);

  assert.equal(result.source, "web_settings");
  assert.equal(result.confidence, "medium");
  assert.deepEqual(
    result.models.map((m) => m.id),
    ["claude-sonnet-4.6", "gpt-5.4", "sonar"]
  );
});
