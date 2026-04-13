import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-chatgpt-model-catalog-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const v1ModelsCatalog = await import("../../src/app/api/v1/models/catalog.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.afterEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("v1 models exposes ChatGPT Web2API under canonical prefix only", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url || "");
    if (target.includes("/backend-api/codex/models")) {
      return new Response(
        JSON.stringify({
          models: [
            { model_slug: "gpt-5.2-codex", display_name: "GPT-5.2 Codex" },
            { model_slug: "gpt-5", display_name: "GPT-5" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`Unexpected fetch in test: ${target}`);
  };

  await providersDb.createProviderConnection({
    provider: "chatgpt-web2api",
    authType: "oauth",
    accessToken: "chatgpt-access-token",
    refreshToken: "__Secure-next-auth.session-token=abc",
    isActive: true,
    providerSpecificData: {
      authMethod: "web2api",
      sessionStatus: "active",
    },
  });

  try {
    const response = await v1ModelsCatalog.getUnifiedModelsResponse(
      new Request("http://localhost/api/v1/models", { method: "GET" })
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    const ids = new Set(body.data.map((item) => item.id));

    assert.ok(ids.has("chatgpt-web2api/gpt-5"));
    assert.ok(ids.has("chatgpt-web2api/gpt-5.2-codex"));
    assert.equal(ids.has("chatgpt-w2a/gpt-5"), false);
    assert.equal(
      [...ids].some((id) => id.startsWith("chatgpt-w2a/")),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
