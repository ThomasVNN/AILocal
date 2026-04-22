import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-web2api-model-catalog-"));
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

test("v1 models exposes Web2API providers under provider-id prefixes only", async () => {
  await providersDb.createProviderConnection({
    provider: "perplexity-web2api",
    authType: "oauth",
    name: "perplexity-web",
    isActive: true,
    providerSpecificData: {
      authMethod: "web2api",
      sessionStatus: "active",
    },
  });

  await providersDb.createProviderConnection({
    provider: "claudew2a",
    authType: "oauth",
    name: "claude-web",
    isActive: true,
    providerSpecificData: {
      authMethod: "web2api",
      sessionStatus: "active",
    },
  });

  const response = await v1ModelsCatalog.getUnifiedModelsResponse(
    new Request("http://localhost/api/v1/models", { method: "GET" })
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  const ids = new Set(body.data.map((item) => item.id));

  assert.ok(ids.has("perplexity-web2api/default"));
  assert.ok(ids.has("perplexity-web2api/gpt-4o"));
  assert.ok(ids.has("claudew2a/claude-sonnet-4-6"));
  assert.ok(ids.has("claudew2a/claude-opus-4-6"));
  assert.equal([...ids].some((id) => id.startsWith("pplx-w2a/")), false);
  assert.equal([...ids].some((id) => id.startsWith("claude-w2a/")), false);

  const web2apiModels = body.data.filter((item) =>
    ["perplexity-web2api", "claudew2a"].includes(item.owned_by)
  );
  const semanticKeys = web2apiModels.map((item) => `${item.owned_by}|${item.root}`);
  assert.equal(semanticKeys.length, new Set(semanticKeys).size);
});
