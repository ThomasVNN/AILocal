import test from "node:test";
import assert from "node:assert/strict";

const { OAUTH_PROVIDERS, APIKEY_PROVIDERS } =
  await import("../../src/shared/constants/providers.ts");
const { REGISTRY } = await import("../../open-sse/config/providerRegistry.ts");
const { DefaultExecutor } = await import("../../open-sse/executors/default.ts");
const { validateProviderApiKey } = await import("../../src/lib/providers/validation.ts");
const { buildClaudeWebCompletionPayload, normalizeClaudeWebModel, normalizeClaudeWebSessionInput } =
  await import("../../open-sse/utils/claudeWebSession.ts");

const CAPTURED_HEADERS = `
:method: POST
:authority: claude.ai
:scheme: https
:path: /api/organizations/b9c40d67-408a-453a-827b-b3dbec951661/chat_conversations/de8c7dc4-7b25-4ffd-9830-36cea8cff187/completion
accept: text/event-stream
anthropic-anonymous-id: claudeai.v1.test-anonymous
anthropic-client-app: com.anthropic.claudefordesktop
anthropic-client-version: 1.3561.0
anthropic-device-id: 49991d10-6725-4600-800a-3ca5168b4c6f
cookie: anthropic-device-id=49991d10-6725-4600-800a-3ca5168b4c6f
cookie: sessionKey=sk-ant-sid02-test
cookie: lastActiveOrg=b9c40d67-408a-453a-827b-b3dbec951661
cookie: cf_clearance=test-clearance
referer: https://claude.ai/new
user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Claude/1.3561.0
x-activity-session-id: 46995d50-c365-4c0a-b359-f6ef19b3875c
`;

test("OAUTH_PROVIDERS includes claudew2a and keeps it separate from API key providers", () => {
  assert.ok(OAUTH_PROVIDERS.claudew2a, "claudew2a should be present in OAUTH_PROVIDERS");
  assert.equal(OAUTH_PROVIDERS.claudew2a.id, "claudew2a");
  assert.equal(OAUTH_PROVIDERS.claudew2a.alias, "claude-w2a");
  assert.equal(OAUTH_PROVIDERS.claudew2a.name, "Claude (Web2API)");
  assert.equal(APIKEY_PROVIDERS.claudew2a, undefined);
});

test("REGISTRY includes claudew2a as a Claude-format web session provider", () => {
  const entry = REGISTRY.claudew2a;
  assert.ok(entry, "Registry should include claudew2a");
  assert.equal(entry.format, "claude");
  assert.equal(entry.executor, "default");
  assert.equal(entry.authType, "oauth");
  assert.equal(entry.authHeader, "cookie");
  assert.equal(entry.baseUrl, "https://claude.ai");
  assert.ok(entry.models.some((model) => model.id === "claude-sonnet-4-6"));
});

test("normalizeClaudeWebModel strips claudew2a prefixes", () => {
  assert.equal(normalizeClaudeWebModel("claudew2a/claude-sonnet-4-6"), "claude-sonnet-4-6");
  assert.equal(normalizeClaudeWebModel("claude-w2a/claude-opus-4-6"), "claude-opus-4-6");
  assert.equal(normalizeClaudeWebModel(""), "claude-sonnet-4-6");
});

test("normalizeClaudeWebSessionInput accepts captured Claude request headers", () => {
  const normalized = normalizeClaudeWebSessionInput(CAPTURED_HEADERS);
  assert.equal(normalized.valid, true);
  assert.equal(normalized.organizationUuid, "b9c40d67-408a-453a-827b-b3dbec951661");
  assert.ok(normalized.cookieString.includes("sessionKey=sk-ant-sid02-test"));
  assert.ok(normalized.cookieString.includes("lastActiveOrg=b9c40d67-408a-453a-827b-b3dbec951661"));
  assert.ok(normalized.cookieNames.includes("cf_clearance"));
  assert.equal(
    normalized.requestHeaders["anthropic-device-id"],
    "49991d10-6725-4600-800a-3ca5168b4c6f"
  );
  assert.equal(normalized.requestHeaders["anthropic-client-version"], "1.3561.0");
});

test("buildClaudeWebCompletionPayload compiles chat messages into Claude web completion shape", () => {
  const payload = buildClaudeWebCompletionPayload({
    model: "claudew2a/claude-sonnet-4-6",
    body: {
      messages: [
        { role: "system", content: "Answer in Vietnamese." },
        { role: "user", content: "topic mới" },
      ],
    },
    conversationUuid: "de8c7dc4-7b25-4ffd-9830-36cea8cff187",
    timezone: "Asia/Saigon",
    locale: "en-US",
  });

  assert.equal(payload.model, "claude-sonnet-4-6");
  assert.equal(payload.timezone, "Asia/Saigon");
  assert.equal(payload.locale, "en-US");
  assert.match(payload.prompt, /System instructions:/);
  assert.match(payload.prompt, /Answer in Vietnamese\./);
  assert.match(payload.prompt, /Current user request:\ntopic mới/);
  assert.equal(payload.create_conversation_params.model, "claude-sonnet-4-6");
  assert.equal(payload.create_conversation_params.include_conversation_preferences, true);
  assert.equal(payload.create_conversation_params.is_temporary, false);
  assert.match(payload.turn_message_uuids.human_message_uuid, /^[0-9a-f-]{36}$/);
  assert.match(payload.turn_message_uuids.assistant_message_uuid, /^[0-9a-f-]{36}$/);
});

test("DefaultExecutor sends claudew2a requests to organization conversation completion", async () => {
  const executor = new DefaultExecutor("claudew2a");
  const credentials = {
    accessToken: "sessionKey=sk-ant-sid02-test; lastActiveOrg=b9c40d67-408a-453a-827b-b3dbec951661",
    providerSpecificData: {
      organizationUuid: "b9c40d67-408a-453a-827b-b3dbec951661",
      requestHeaders: {
        "anthropic-device-id": "49991d10-6725-4600-800a-3ca5168b4c6f",
      },
    },
  };

  const url = executor.buildUrl("claude-sonnet-4-6", true, 0, credentials);
  assert.match(
    url,
    /^https:\/\/claude\.ai\/api\/organizations\/b9c40d67-408a-453a-827b-b3dbec951661\/chat_conversations\/[0-9a-f-]{36}\/completion$/
  );

  const headers = executor.buildHeaders(credentials, true);
  assert.equal(headers.Cookie, credentials.accessToken);
  assert.equal(headers["x-organization-uuid"], "b9c40d67-408a-453a-827b-b3dbec951661");
  assert.equal(headers["anthropic-device-id"], "49991d10-6725-4600-800a-3ca5168b4c6f");
  assert.equal(headers.Accept, "text/event-stream");
  assert.equal(headers.Authorization, undefined);

  const body = await executor.transformRequest(
    "claudew2a/claude-sonnet-4-6",
    { messages: [{ role: "user", content: "hello" }] },
    true,
    credentials
  );
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.prompt, "hello");
  assert.equal(body.create_conversation_params.model, "claude-sonnet-4-6");
});

test("validateProviderApiKey validates claudew2a via Claude organization environment endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedHeaders = {};

  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedHeaders = init?.headers || {};
    return new Response(JSON.stringify({ data: [], has_more: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await validateProviderApiKey({
      provider: "claudew2a",
      apiKey: CAPTURED_HEADERS,
    });

    assert.equal(result.valid, true);
    assert.equal(result.error, null);
    assert.equal(result.organizationUuid, "b9c40d67-408a-453a-827b-b3dbec951661");
    assert.match(
      capturedUrl,
      /https:\/\/claude\.ai\/v1\/environment_providers\/private\/organizations\/b9c40d67-408a-453a-827b-b3dbec951661\/environments$/
    );
    assert.ok(String(capturedHeaders.Cookie).includes("sessionKey=sk-ant-sid02-test"));
    assert.equal(capturedHeaders["x-organization-uuid"], "b9c40d67-408a-453a-827b-b3dbec951661");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
