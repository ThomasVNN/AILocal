/**
 * OAuth Provider Registry — Extracted from monolithic providers.js
 *
 * Each provider is now defined in its own module under providers/.
 * This index re-exports the full PROVIDERS map and utility functions.
 *
 * Provider modules follow the interface:
 *   { config, flowType, buildAuthUrl?, exchangeToken?, requestDeviceCode?, pollToken?, postExchange?, mapTokens }
 *
 * @module lib/oauth/providers/index
 */

import { claude } from "./claude";
import { codex } from "./codex";
import { gemini } from "./gemini";
import { antigravity } from "./antigravity";
import { qoder } from "./qoder";
import { qwen } from "./qwen";
import { kimiCoding } from "./kimi-coding";
import { github } from "./github";
import { kiro } from "./kiro";
import { cursor } from "./cursor";
import { kilocode } from "./kilocode";
import { cline } from "./cline";
import { perplexityWeb2api } from "./perplexity-web2api";
import { chatgptWeb2api } from "./chatgpt-web2api";
import { geminiWeb2api } from "./gemini-web2api";

export const PROVIDERS = {
  claude,
  codex,
  "gemini-cli": gemini,
  antigravity,
  qoder,
  qwen,
  "kimi-coding": kimiCoding,
  github,
  kiro,
  cursor,
  kilocode,
  cline,
  "perplexity-web2api": perplexityWeb2api,
  "chatgpt-web2api": chatgptWeb2api,
  "gemini-web2api": geminiWeb2api,
};

export default PROVIDERS;
