import test from "node:test";
import assert from "node:assert/strict";

const {
  compactChatgptCookieString,
  normalizeChatgptCookieString,
  validateChatgptSessionCookie,
  validateChatgptSessionPayload,
  validateChatgptImportedSessionPayload,
  validateChatgptAccessToken,
} = await import("../../open-sse/utils/chatgptSession.ts");

function makeJwt(payload) {
  const b64 = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

test("compactChatgptCookieString keeps only essential auth cookies", () => {
  const raw =
    "__Secure-next-auth.session-token=st_123; foo=bar; oai-did=did_1; another=value; __cf_bm=cfbm";
  const compact = compactChatgptCookieString(raw);
  assert.equal(compact.includes("__Secure-next-auth.session-token=st_123"), true);
  assert.equal(compact.includes("oai-did=did_1"), true);
  assert.equal(compact.includes("__cf_bm=cfbm"), true);
  assert.equal(compact.includes("foo=bar"), false);
  assert.equal(compact.includes("another=value"), false);
});

test("normalizeChatgptCookieString accepts JSON cookie export array", () => {
  const raw = JSON.stringify([
    { name: "__Secure-next-auth.session-token", value: "json-token-1" },
    { name: "oai-did", value: "device-1" },
  ]);

  const normalized = normalizeChatgptCookieString(raw, { allowBareSessionToken: true });
  assert.equal(normalized.valid, true);
  if (!normalized.valid) return;
  assert.match(normalized.cookieString, /__Secure-next-auth\.session-token=json-token-1/);
  assert.match(normalized.cookieString, /oai-did=device-1/);
});

test("validateChatgptSessionCookie retries with compact cookie when upstream returns 431", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const cookie = init?.headers?.Cookie || "";
    calls.push(cookie);
    if (calls.length === 1) {
      return new Response("header too large", { status: 431 });
    }
    return new Response(
      JSON.stringify({
        user: { id: "user_1", email: "u@example.com", name: "User" },
        accessToken: "header.payload.signature",
        account: { id: "acct_1", planType: "go" },
        expires: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const rawCookie =
    "__Secure-next-auth.session-token=st_123; foo=bar; oai-did=did_1; another=value";
  const result = await validateChatgptSessionCookie(rawCookie, {
    allowBareSessionToken: true,
    fetchImpl,
  });

  assert.equal(result.valid, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].includes("foo=bar"), true);
  assert.equal(calls[1].includes("foo=bar"), false);
  assert.equal(calls[1].includes("__Secure-next-auth.session-token=st_123"), true);
});

test("validateChatgptSessionPayload accepts access-token-only session payload", async () => {
  const payload = {
    user: { id: "user_1", email: "u@example.com", name: "User" },
    accessToken: "header.payload.signature",
    account: { id: "acct_1", planType: "go" },
    expires: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };

  const result = await validateChatgptSessionPayload(payload, {
    allowBareSessionToken: true,
  });

  assert.equal(result.valid, true);
  assert.equal(result.cookieString, "");
  assert.equal(result.accountId, "acct_1");
});

test("validateChatgptSessionPayload derives account context from access token claims", async () => {
  const jwt = makeJwt({
    exp: Math.floor(Date.now() / 1000) + 3600,
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_claim_1",
      chatgpt_plan_type: "go",
    },
  });

  const payload = {
    user: { id: "user_claim", email: "claim@example.com", name: "Claim User" },
    accessToken: jwt,
  };

  const result = await validateChatgptSessionPayload(payload, {
    allowBareSessionToken: true,
  });

  assert.equal(result.valid, true);
  assert.equal(result.accountId, "acct_claim_1");
  assert.equal(result.planType, "go");
});

test("validateChatgptImportedSessionPayload falls back to bearer-only mode when session cookie is stale", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (String(url).includes("/api/auth/session")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ limit: 42 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const payload = {
    user: { id: "user_stale", email: "stale@example.com", name: "Stale User" },
    accessToken: "header.payload.signature",
    sessionToken: "session-token-123",
    account: { id: "acct_stale", planType: "go" },
  };

  const result = await validateChatgptImportedSessionPayload(payload, {
    allowBareSessionToken: true,
    fetchImpl,
  });

  assert.equal(result.valid, true);
  assert.equal(result.cookieString, "");
  assert.deepEqual(result.cookieNames, []);
  assert.equal(result.session.email, "stale@example.com");
  assert.equal(result.accountId, "acct_stale");
  assert.equal(result.planType, "go");
  assert.equal(calls, 2);
});

test("validateChatgptImportedSessionPayload falls back to bearer-only mode when session cookie is forbidden", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (String(url).includes("/api/auth/session")) {
      return new Response("forbidden", {
        status: 403,
        headers: { "content-type": "text/plain" },
      });
    }

    return new Response(JSON.stringify({ limit: 42 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const payload = {
    user: { id: "user_forbidden", email: "forbidden@example.com", name: "Forbidden User" },
    accessToken: "header.payload.signature",
    sessionToken: "session-token-forbidden",
    account: { id: "acct_forbidden", planType: "plus" },
  };

  const result = await validateChatgptImportedSessionPayload(payload, {
    allowBareSessionToken: true,
    fetchImpl,
  });

  assert.equal(result.valid, true);
  assert.equal(result.cookieString, "");
  assert.deepEqual(result.cookieNames, []);
  assert.equal(result.session.email, "forbidden@example.com");
  assert.equal(result.accountId, "acct_forbidden");
  assert.equal(result.planType, "plus");
  assert.equal(calls, 2);
});

test("validateChatgptAccessToken does not reject non-JWT token format before upstream check", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const result = await validateChatgptAccessToken("opaque-token-value", { fetchImpl });
  assert.equal(result.valid, true);
});
