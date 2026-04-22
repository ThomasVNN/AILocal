import test from "node:test";
import assert from "node:assert/strict";

const { GeminiWebExecutor } = await import("../../open-sse/executors/gemini-web.ts");

function buildGeminiBootstrapHtml() {
  return `<!doctype html><script>window.WIZ_global_data={"thykhd":"gemini-at-token","cfb2h":"boq_assistant-bard-web-server_20260419.08_p0","FdrFJe":"4371343308878890333","TuX5cc":"en","qKIAYe":"feeds/mcudyrk2a4khkz"};</script>`;
}

function buildGeminiStreamFrame(text = "executor ok") {
  const candidate = [];
  candidate[0] = "rcid-test";
  candidate[1] = [text];
  candidate[8] = [2];

  const inner = [];
  inner[4] = [candidate];

  const outer = [];
  outer[2] = JSON.stringify(inner);

  const payload = JSON.stringify([outer]);
  return `)]}'\n${payload.length + 2}\n${payload}\n`;
}

test("GeminiWebExecutor routes chat completions through stored Gemini web capture data", async () => {
  const executor = new GeminiWebExecutor();
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET" });
    if (String(url).includes("/app")) {
      return new Response(buildGeminiBootstrapHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    return new Response(buildGeminiStreamFrame("executor ok"), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };

  try {
    const result = await executor.execute({
      model: "gemini-2.5-flash",
      body: {
        messages: [{ role: "user", content: "hello" }],
      },
      stream: false,
      credentials: {
        accessToken: "gemini-at-token",
        providerSpecificData: {
          requestHeaders: {
            Cookie: "__Secure-1PSID=CookieValue123; __Secure-1PSIDTS=CookieTsValue123",
          },
          routePrefix: "/u/1",
          streamQueryParams: {
            bl: "boq_assistant-bard-web-server_20260419.08_p0",
            "f.sid": "4371343308878890333",
            hl: "en",
            pageId: "none",
            rt: "c",
          },
          streamRequestTemplate:
            "[[\"hi \",0,null,null,null,null,0],[\"en\"],[\"\",\"\",\"\"] ,null,null,null,[1],1]",
        },
      },
    });

    assert.ok(result.response);
    assert.equal(result.response.status, 200);
    const payload = await result.response.json();
    assert.equal(payload.choices?.[0]?.message?.content, "executor ok");
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]?.url || "", /StreamGenerate/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
