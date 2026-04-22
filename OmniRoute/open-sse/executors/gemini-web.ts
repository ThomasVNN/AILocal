import { randomUUID } from "node:crypto";

import { BaseExecutor, mergeAbortSignals, type ExecuteInput } from "./base.ts";
import { FETCH_TIMEOUT_MS } from "../config/constants.ts";
import {
  bootstrapGeminiWebRuntime,
  buildGeminiWebPrompt,
  buildGeminiWebStreamBody,
  buildGeminiWebStreamHeaders,
  extractGeminiWebResponseState,
  parseGeminiWebResponseFrames,
  resolveGeminiWebStreamUrl,
} from "../utils/geminiWebSession.ts";

const GEMINI_WEB_EXECUTOR_ID = "gemini-web2api";

function buildOpenAIErrorResponse(message: string, status = 502, code = "upstream_error") {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: code,
        code,
      },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function buildChunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null
) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

function computeDelta(nextValue: string, previousValue: string): { delta: string; full: string } {
  if (!nextValue) return { delta: "", full: previousValue };
  if (!previousValue) return { delta: nextValue, full: nextValue };
  if (nextValue.startsWith(previousValue)) {
    return {
      delta: nextValue.slice(previousValue.length),
      full: nextValue,
    };
  }

  let prefixLength = 0;
  while (
    prefixLength < nextValue.length &&
    prefixLength < previousValue.length &&
    nextValue[prefixLength] === previousValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  if (prefixLength === nextValue.length) {
    return { delta: "", full: previousValue };
  }

  return {
    delta: nextValue.slice(prefixLength),
    full: nextValue,
  };
}

async function* readGeminiWebStates(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal | null
): AsyncGenerator<ReturnType<typeof extractGeminiWebResponseState>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parsed = parseGeminiWebResponseFrames(buffer);
      buffer = parsed.remaining;
      if (parsed.parts.length > 0) {
        yield extractGeminiWebResponseState(parsed.parts);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseGeminiWebResponseFrames(buffer);
      if (parsed.parts.length > 0) {
        yield extractGeminiWebResponseState(parsed.parts);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function buildStreamingResponse(
  body: ReadableStream<Uint8Array>,
  model: string,
  id: string,
  created: number,
  signal?: AbortSignal | null
) {
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let started = false;
      let finished = false;
      let lastText = "";
      let lastThoughts = "";

      try {
        for await (const state of readGeminiWebStates(body, signal)) {
          if (state.errorCode && !started && !state.text && !state.thoughts) {
            const errorText = `[Proxy Error] Gemini web session returned ${state.errorCode}.`;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(buildChunk(id, created, model, { role: "assistant" }))}\n\n`)
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(buildChunk(id, created, model, { content: errorText }))}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(buildChunk(id, created, model, {}, "stop"))}\n\n`)
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            finished = true;
            controller.close();
            return;
          }

          const textDelta = computeDelta(state.text, lastText);
          const thoughtDelta = computeDelta(state.thoughts, lastThoughts);
          lastText = textDelta.full;
          lastThoughts = thoughtDelta.full;

          if (!started && (thoughtDelta.delta || textDelta.delta || state.completed)) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(buildChunk(id, created, model, { role: "assistant" }))}\n\n`)
            );
            started = true;
          }

          if (thoughtDelta.delta) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(buildChunk(id, created, model, { reasoning_content: thoughtDelta.delta }))}\n\n`
              )
            );
          }

          if (textDelta.delta) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(buildChunk(id, created, model, { content: textDelta.delta }))}\n\n`
              )
            );
          }

          if (state.completed && !finished) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(buildChunk(id, created, model, {}, "stop"))}\n\n`)
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            finished = true;
            controller.close();
            return;
          }
        }

        if (!finished) {
          if (!started) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(buildChunk(id, created, model, { role: "assistant" }))}\n\n`)
            );
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(buildChunk(id, created, model, {}, "stop"))}\n\n`)
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

async function buildNonStreamingResponse(
  body: ReadableStream<Uint8Array>,
  model: string,
  id: string,
  created: number,
  signal?: AbortSignal | null
) {
  let latestText = "";
  let latestThoughts = "";
  let latestErrorCode: string | null = null;

  for await (const state of readGeminiWebStates(body, signal)) {
    if (state.text) latestText = state.text;
    if (state.thoughts) latestThoughts = state.thoughts;
    if (state.errorCode) latestErrorCode = state.errorCode;
  }

  if (!latestText && !latestThoughts && latestErrorCode) {
    return buildOpenAIErrorResponse(
      `Gemini web session returned ${latestErrorCode}. Re-import a fresh browser capture.`,
      502
    );
  }

  const content = latestText || latestThoughts;
  return new Response(
    JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super(GEMINI_WEB_EXECUTOR_ID, {
      id: GEMINI_WEB_EXECUTOR_ID,
      baseUrl: "https://gemini.google.com",
      format: "openai",
    });
  }

  async execute({ model, body, stream, credentials, signal, log }: ExecuteInput) {
    const prompt = buildGeminiWebPrompt(body);
    if (!prompt) {
      const errorResponse = buildOpenAIErrorResponse("Missing or empty messages array", 400, "invalid_request");
      return { response: errorResponse, url: "https://gemini.google.com", headers: {}, transformedBody: body };
    }

    const providerSpecificData =
      credentials.providerSpecificData && typeof credentials.providerSpecificData === "object"
        ? credentials.providerSpecificData
        : {};

    const bootstrap = await bootstrapGeminiWebRuntime(
      {
        requestHeaders: providerSpecificData.requestHeaders,
        authorizationHeader: providerSpecificData.authorizationHeader,
        routePrefix: providerSpecificData.routePrefix,
        authUser: providerSpecificData.authUser,
        modelHeaderTemplate: providerSpecificData.modelHeaderTemplate,
        streamQueryParams: providerSpecificData.streamQueryParams,
        streamRequestTemplate: providerSpecificData.streamRequestTemplate,
        accessToken:
          typeof credentials.accessToken === "string" ? credentials.accessToken.trim() : null,
        url:
          typeof providerSpecificData.routePrefix === "string"
            ? `https://gemini.google.com${providerSpecificData.routePrefix}/app`
            : undefined,
      },
      { signal }
    );

    if (!bootstrap.valid) {
      const status =
        bootstrap.statusCode === 400
          ? 400
          : bootstrap.statusCode === 401 || bootstrap.statusCode === 403
            ? 401
            : 502;
      const errorResponse = buildOpenAIErrorResponse(bootstrap.error, status, bootstrap.errorCode);
      return {
        response: errorResponse,
        url: "https://gemini.google.com",
        headers: bootstrap.requestHeaders,
        transformedBody: { prompt },
      };
    }

    const headers = buildGeminiWebStreamHeaders(
      bootstrap.requestHeaders,
      bootstrap.routePrefix,
      model,
      bootstrap.modelHeaderTemplate
    );
    const form = buildGeminiWebStreamBody(
      prompt,
      bootstrap.language,
      bootstrap.streamRequestTemplate
    );
    form.set("at", bootstrap.accessToken);

    const url = resolveGeminiWebStreamUrl(bootstrap.routePrefix, {
      bl: bootstrap.streamQueryParams?.bl || bootstrap.buildLabel || "",
      "f.sid": bootstrap.streamQueryParams?.["f.sid"] || bootstrap.sessionId || "",
      hl: bootstrap.streamQueryParams?.hl || bootstrap.language,
      pageId: bootstrap.streamQueryParams?.pageId || "none",
      _reqid: String(100000 + Math.floor(Math.random() * 900000)),
      rt: bootstrap.streamQueryParams?.rt || "c",
    });

    log?.info?.("GEMINI-WEB", `Request to ${model}, routePrefix=${bootstrap.routePrefix || "/"}`);

    const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const combinedSignal = signal ? mergeAbortSignals(signal, timeoutSignal) : timeoutSignal;

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(url, {
        method: "POST",
        headers,
        body: form.toString(),
        signal: combinedSignal,
      });
    } catch (error) {
      const errorResponse = buildOpenAIErrorResponse(
        `Gemini web connection failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
      return { response: errorResponse, url, headers, transformedBody: { prompt } };
    }

    if (!upstreamResponse.ok) {
      const message =
        upstreamResponse.status === 401 || upstreamResponse.status === 403
          ? "Gemini web auth failed. Re-import a fresh browser capture from gemini.google.com."
          : upstreamResponse.status === 429
            ? "Gemini web rate limited the session. Retry later."
            : `Gemini web returned HTTP ${upstreamResponse.status}.`;
      const errorResponse = buildOpenAIErrorResponse(message, upstreamResponse.status);
      return { response: errorResponse, url, headers, transformedBody: { prompt } };
    }

    if (!upstreamResponse.body) {
      const errorResponse = buildOpenAIErrorResponse("Gemini web returned empty response body", 502);
      return { response: errorResponse, url, headers, transformedBody: { prompt } };
    }

    const id = `chatcmpl-gemw2a-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const finalResponse = stream
      ? new Response(buildStreamingResponse(upstreamResponse.body, model, id, created, signal), {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
          },
        })
      : await buildNonStreamingResponse(upstreamResponse.body, model, id, created, signal);

    return {
      response: finalResponse,
      url,
      headers,
      transformedBody: { prompt },
    };
  }
}
