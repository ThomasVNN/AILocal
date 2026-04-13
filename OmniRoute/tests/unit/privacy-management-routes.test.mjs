import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-privacy-routes-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "privacy-routes-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");

async function resetStorage() {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("privacy config GET returns authenticated config payload", async () => {
  const { GET } = await import("../../src/app/api/privacy/config/route.ts");
  const key = await apiKeysDb.createApiKey("privacy-admin", "machine-privacy-routes");

  const req = new Request("http://localhost/api/privacy/config", {
    method: "GET",
    headers: {
      authorization: `Bearer ${key.key}`,
    },
  });

  const res = await GET(req);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(json.config.entityTypes));
  assert.equal(typeof json.activeBundle.version, "string");
});

test("privacy config PATCH updates document sets and activates a new bundle", async () => {
  const { PATCH } = await import("../../src/app/api/privacy/config/route.ts");
  const key = await apiKeysDb.createApiKey("privacy-admin", "machine-privacy-routes");

  const req = new Request("http://localhost/api/privacy/config", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${key.key}`,
    },
    body: JSON.stringify({
      documentSets: [
        {
          id: "unit-docs",
          name: "Unit Docs",
          documentClass: "internal",
          businessDomain: "qa",
          sourceType: "manual",
          version: 1,
          status: "published",
          entries: [{ id: "term-1", term: "UNIT-PRJ-9", entityTypeId: "project_code" }],
        },
      ],
    }),
  });

  const res = await PATCH(req);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.config.documentSets[0].id, "unit-docs");
  assert.match(json.activeBundle.version, /^privacy-/);
});
