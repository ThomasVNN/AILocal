import { register } from "../registry.ts";
import { FORMATS } from "../formats.ts";
import {
  extractPerplexityWeb2ApiText,
  getPerplexityWeb2ApiMessageId,
  getPerplexityWeb2ApiModel,
  isPerplexityWeb2ApiFinal,
} from "../helpers/perplexityWeb2ApiHelper.ts";

function createOpenAIChunk(state, delta, finishReason = null) {
  return {
    id: `chatcmpl-${state.messageId}`,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model || "default",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

export function perplexityWeb2ApiToOpenAIResponse(chunk, state) {
  if (!chunk) {
    if (!state?.started || state.finishReasonSent) return null;
    state.finishReasonSent = true;
    state.finishReason = "stop";
    return createOpenAIChunk(state, {}, "stop");
  }

  const results = [];

  if (!state.messageId) {
    state.messageId = getPerplexityWeb2ApiMessageId(chunk) || `${Date.now()}`;
    state.model = getPerplexityWeb2ApiModel(chunk, state.model || "default");
    state.created = Math.floor(Date.now() / 1000);
    state.started = true;
    state.perplexityText = "";
    results.push(createOpenAIChunk(state, { role: "assistant" }));
  }

  const currentText = typeof state.perplexityText === "string" ? state.perplexityText : "";
  const nextText = extractPerplexityWeb2ApiText(chunk, currentText);

  if (typeof nextText === "string" && nextText.length > currentText.length) {
    const deltaText = nextText.startsWith(currentText) ? nextText.slice(currentText.length) : nextText;
    if (deltaText.length > 0) {
      results.push(createOpenAIChunk(state, { content: deltaText }));
    }
    state.perplexityText = nextText;
  }

  if (isPerplexityWeb2ApiFinal(chunk) && !state.finishReasonSent) {
    state.finishReasonSent = true;
    state.finishReason = "stop";
    results.push(createOpenAIChunk(state, {}, "stop"));
  }

  return results.length > 0 ? results : null;
}

register(
  FORMATS.PERPLEXITY_WEB2API,
  FORMATS.OPENAI,
  null,
  perplexityWeb2ApiToOpenAIResponse
);
