import { register } from "../registry.ts";
import { FORMATS } from "../formats.ts";
import { buildPerplexityWeb2ApiRequest } from "../helpers/perplexityWeb2ApiHelper.ts";

export function openaiToPerplexityWeb2ApiRequest(model, body) {
  return buildPerplexityWeb2ApiRequest(model, body || {});
}

register(
  FORMATS.OPENAI,
  FORMATS.PERPLEXITY_WEB2API,
  openaiToPerplexityWeb2ApiRequest
);
