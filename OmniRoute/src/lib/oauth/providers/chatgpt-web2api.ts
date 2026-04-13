import { CHATGPT_WEB2API_CONFIG } from "../constants/oauth";

export const chatgptWeb2api = {
  config: CHATGPT_WEB2API_CONFIG,
  flowType: "import_token",
  mapTokens: (tokens) => ({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || null,
    expiresIn: tokens.expiresIn || 1800,
    providerSpecificData: {
      authMethod: "web2api",
      sessionSource: "browser_cookie",
    },
  }),
};
