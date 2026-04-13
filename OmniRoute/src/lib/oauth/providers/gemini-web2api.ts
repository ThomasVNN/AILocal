import { GEMINI_WEB2API_CONFIG } from "../constants/oauth";

export const geminiWeb2api = {
  config: GEMINI_WEB2API_CONFIG,
  flowType: "import_token",
  mapTokens: (tokens) => ({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || null,
    expiresIn: tokens.expiresIn || 30 * 24 * 60 * 60,
    providerSpecificData: {
      authMethod: "web2api",
      sessionSource: "browser_request_headers",
    },
  }),
};
