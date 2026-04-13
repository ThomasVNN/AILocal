import test from "node:test";
import assert from "node:assert/strict";

const { discoverChatgptWebModels, getChatgptWeb2ApiFallbackModels } =
  await import("../../open-sse/utils/chatgptWebModels.ts");

test("discoverChatgptWebModels returns fallback when token missing", async () => {
  const result = await discoverChatgptWebModels({});

  assert.equal(result.source, "fallback_static");
  assert.equal(result.confidence, "low");
  assert.deepEqual(result.models, getChatgptWeb2ApiFallbackModels());
});

test("discoverChatgptWebModels parses codex models endpoint response", async () => {
  const fetchMock = async () =>
    new Response(
      JSON.stringify({
        models: [
          { model_slug: "gpt-5.2-codex", display_name: "GPT-5.2 Codex" },
          { model_slug: "gpt-5", display_name: "GPT-5" },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );

  const result = await discoverChatgptWebModels(
    {
      accessToken: "token-value",
      cookieString: "__Secure-next-auth.session-token=abc",
    },
    fetchMock
  );

  assert.equal(result.source, "codex_models");
  assert.equal(result.confidence, "high");
  assert.deepEqual(
    result.models.map((model) => model.id),
    ["gpt-5.2-codex", "gpt-5"]
  );
});

test("discoverChatgptWebModels falls back when endpoint fails", async () => {
  const fetchMock = async () =>
    new Response(JSON.stringify({ detail: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });

  const result = await discoverChatgptWebModels({ accessToken: "token-value" }, fetchMock);

  assert.equal(result.source, "fallback_static");
  assert.equal(result.confidence, "low");
  assert.equal(result.models.length >= 3, true);
});
