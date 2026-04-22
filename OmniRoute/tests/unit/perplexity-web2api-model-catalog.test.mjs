import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-pplx-model-catalog-"));
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

test("v1 models keeps Perplexity Web2API limited to curated LocalAgent models even when discovery returns extras", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url || "");
    if (target.includes("perplexity.ai/rest/models/config")) {
      return new Response(
        JSON.stringify({
          models: [
            { id: "default", name: "Perplexity Default" },
            { id: "gpt-4o", name: "GPT-4o" },
            { id: "turbo", name: "Turbo" },
            { id: "pplx_pro", name: "Perplexity Pro" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (target.includes("perplexity.ai/rest/models")) {
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.includes("perplexity.ai/rest/user/settings")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch in test: ${target}`);
  };

  await providersDb.createProviderConnection({
    provider: "perplexity-web2api",
    authType: "oauth",
    accessToken: "perplexity-access-token",
    name: "perplexity-web",
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

    assert.ok(ids.has("perplexity-web2api/default"));
    assert.ok(ids.has("perplexity-web2api/gpt-4o"));
    assert.equal(ids.has("perplexity-web2api/turbo"), false);
    assert.equal(ids.has("perplexity-web2api/pplx_pro"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
