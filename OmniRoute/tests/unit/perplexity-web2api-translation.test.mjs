import test from "node:test";
import assert from "node:assert/strict";

const { translateRequest, translateResponse, initState, FORMATS } =
  await import("../../open-sse/index.ts");
const { parseSSEToPerplexityWeb2ApiResponse } =
  await import("../../open-sse/handlers/sseParser.ts");
const { translateNonStreamingResponse } =
  await import("../../open-sse/handlers/responseTranslator.ts");
const { DefaultExecutor } = await import("../../open-sse/executors/default.ts");

test("Perplexity Web2API request translator builds query_str and params from chat messages", () => {
  const translated = translateRequest(
    FORMATS.OPENAI,
    FORMATS.PERPLEXITY_WEB2API,
    "gpt-4o",
    {
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Summarize this." },
        { role: "assistant", content: "Need more context." },
        { role: "user", content: "Reply with exactly: ok" },
      ],
    },
    false,
    null,
    "perplexity-web2api"
  );

  assert.equal(translated.query_str.includes("System instructions:"), true);
  assert.equal(
    translated.query_str.includes("Current user request:\nReply with exactly: ok"),
    true
  );
  assert.deepEqual(translated.params, {
    attachments: [],
    query_source: "home",
    model_preference: "gpt4",
  });
});

test("Perplexity Web2API response translator emits incremental OpenAI chunks and suppresses duplicate final answer", () => {
  const state = initState(FORMATS.OPENAI);

  const first = translateResponse(
    FORMATS.PERPLEXITY_WEB2API,
    FORMATS.OPENAI,
    {
      uuid: "msg-1",
      source: "default",
      blocks: [
        {
          markdown_block: {
            progress: "IN_PROGRESS",
            chunks: ["ok"],
            chunk_starting_offset: 0,
          },
        },
      ],
      text_completed: false,
    },
    state
  );

  assert.equal(first.length, 2);
  assert.equal(first[0].choices[0].delta.role, "assistant");
  assert.equal(first[1].choices[0].delta.content, "ok");

  const second = translateResponse(
    FORMATS.PERPLEXITY_WEB2API,
    FORMATS.OPENAI,
    {
      uuid: "msg-1",
      source: "default",
      text_completed: true,
      final_sse_message: true,
      blocks: [
        {
          markdown_block: {
            progress: "DONE",
            chunks: ["ok"],
            chunk_starting_offset: 0,
            answer: "ok",
          },
        },
      ],
    },
    state
  );

  assert.equal(second.length, 1);
  assert.equal(second[0].choices[0].finish_reason, "stop");
});

test("Perplexity Web2API SSE parser and non-stream translator produce an OpenAI completion", () => {
  const rawSSE = [
    "event: message",
    'data: {"uuid":"msg-2","source":"default","text_completed":false,"blocks":[{"markdown_block":{"progress":"IN_PROGRESS","chunks":["he"],"chunk_starting_offset":0}}]}',
    "",
    "event: message",
    'data: {"uuid":"msg-2","source":"default","text_completed":true,"final_sse_message":true,"blocks":[{"markdown_block":{"progress":"DONE","chunks":["llo"],"chunk_starting_offset":2,"answer":"hello"}}]}',
    "",
  ].join("\n");

  const parsed = parseSSEToPerplexityWeb2ApiResponse(rawSSE, "default");
  assert.equal(parsed.answer, "hello");

  const translated = translateNonStreamingResponse(
    parsed,
    FORMATS.PERPLEXITY_WEB2API,
    FORMATS.OPENAI
  );

  assert.equal(translated.model, "default");
  assert.equal(translated.choices[0].message.content, "hello");
  assert.equal(translated.choices[0].finish_reason, "stop");
});

test("Perplexity Web2API extracts top-level text when upstream returns a failed final event", () => {
  const state = initState(FORMATS.OPENAI);
  const translated = translateResponse(
    FORMATS.PERPLEXITY_WEB2API,
    FORMATS.OPENAI,
    {
      uuid: "msg-3",
      source: "default",
      status: "failed",
      final_sse_message: true,
      text: "Error in processing query.",
      blocks: [],
    },
    state
  );

  assert.equal(translated.length, 3);
  assert.equal(translated[0].choices[0].delta.role, "assistant");
  assert.equal(translated[1].choices[0].delta.content, "Error in processing query.");
  assert.equal(translated[2].choices[0].finish_reason, "stop");
});

test("Perplexity Web2API executor preserves translated payload and normalizes model preference", () => {
  const executor = new DefaultExecutor("perplexity-web2api");
  const transformed = executor.transformRequest(
    "gpt-4o",
    {
      query_str: "reply with ok",
      params: {
        attachments: [],
        query_source: "home",
      },
    },
    false,
    null
  );

  assert.equal(transformed.query_str, "reply with ok");
  assert.deepEqual(transformed.params, {
    attachments: [],
    query_source: "home",
    model_preference: "gpt4",
  });
});

test("Perplexity Web2API normalizer strips provider prefix from synced model ids", () => {
  const executor = new DefaultExecutor("perplexity-web2api");
  const transformed = executor.transformRequest(
    "pplx-w2a/sonar",
    {
      query_str: "hello",
      params: {
        attachments: [],
        query_source: "home",
      },
    },
    false,
    null
  );

  assert.equal(transformed.params.model_preference, "default");
});
