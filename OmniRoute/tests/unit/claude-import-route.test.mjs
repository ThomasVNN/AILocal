import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-claude-import-"));
const TEST_CLAUDE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-claude-config-"));

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.CLAUDE_CONFIG_DIR = TEST_CLAUDE_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const importRoute = await import("../../src/app/api/oauth/claude/import/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  fs.mkdirSync(TEST_CLAUDE_DIR, { recursive: true });
}

test.after(async () => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
});

test("Claude import route stores pasted Claude Code credentials on the existing claude provider", async () => {
  await resetStorage();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ type: "message", id: "msg_123" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const request = new Request("http://localhost/api/oauth/claude/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialsInput: JSON.stringify({
          claudeAiOauth: {
            accessToken: "claude-access-token",
            refreshToken: "claude-refresh-token",
            expiresAt: Date.now() + 60 * 60 * 1000,
            scopes: ["user:inference", "user:profile"],
            subscriptionType: "max",
            rateLimitTier: "pro",
          },
        }),
      }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.success, true);

    const connections = await providersDb.getProviderConnections({ provider: "claude" });
    assert.equal(connections.length, 1);

    const stored = connections[0];
    assert.equal(stored.accessToken, "claude-access-token");
    assert.equal(stored.refreshToken, "claude-refresh-token");
    assert.equal(stored.displayName, "Claude Code (max)");
    assert.equal(stored.providerSpecificData.authMethod, "claude_code_import");
    assert.equal(stored.providerSpecificData.sessionSource, "manual_credentials");
    assert.deepEqual(stored.providerSpecificData.scopes, ["user:inference", "user:profile"]);
    assert.equal(stored.providerSpecificData.subscriptionType, "max");
    assert.equal(stored.providerSpecificData.rateLimitTier, "pro");
    assert.equal(stored.testStatus, "active");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Claude import route can read local .credentials.json and refresh expired tokens", async () => {
  await resetStorage();

  const credentialsPath = path.join(TEST_CLAUDE_DIR, ".credentials.json");
  fs.writeFileSync(
    credentialsPath,
    JSON.stringify(
      {
        claudeAiOauth: {
          accessToken: "expired-access-token",
          refreshToken: "local-refresh-token",
          expiresAt: Date.now() - 60 * 1000,
          scopes: ["user:inference"],
        },
      },
      null,
      2
    )
  );

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));

    if (String(url).includes("/oauth/token")) {
      return new Response(
        JSON.stringify({
          access_token: "refreshed-access-token",
          refresh_token: "refreshed-refresh-token",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ type: "message", id: "msg_refreshed" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const request = new Request("http://localhost/api/oauth/claude/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "local_file" }),
    });

    const response = await importRoute.POST(request);
    assert.equal(response.status, 200);

    const connections = await providersDb.getProviderConnections({ provider: "claude" });
    assert.equal(connections.length, 1);

    const stored = connections[0];
    assert.equal(stored.accessToken, "refreshed-access-token");
    assert.equal(stored.refreshToken, "refreshed-refresh-token");
    assert.equal(stored.providerSpecificData.sessionSource, "local_credentials_file");
    assert.equal(stored.providerSpecificData.credentialsPath, credentialsPath);
    assert.ok(calls.some((url) => url.includes("/oauth/token")));
    assert.ok(calls.some((url) => url.includes("/v1/messages")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
