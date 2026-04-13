import { PERPLEXITY_WEB2API_CONFIG } from "../constants/oauth";

export const perplexityWeb2api = {
  config: PERPLEXITY_WEB2API_CONFIG,
  flowType: "import_token",
  mapTokens: (tokens) => ({
    accessToken: tokens.accessToken,
    refreshToken: null,
    expiresIn: tokens.expiresIn || 86400,
    providerSpecificData: {
      authMethod: "web2api",
      sessionSource: "browser_cookie",
    },
  }),
};
